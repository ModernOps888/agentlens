/**
 * AgentLens MCP Server — Expose trace data to IDE agents.
 *
 * This module implements a minimal MCP server (stdio transport) that allows
 * IDE agents (Antigravity, Claude Code, Cursor, Windsurf) to query AgentLens
 * trace data via standard MCP tool calls.
 *
 * Usage:
 *   1. Run AgentLens: `npm run dev` (serves on http://localhost:3000)
 *   2. Connect your IDE to this MCP server:
 *      ```json
 *      {
 *        "mcpServers": {
 *          "agentlens": {
 *            "command": "node",
 *            "args": ["path/to/agentlens/src/mcp-server-entry.mjs"],
 *            "env": { "AGENTLENS_URL": "http://127.0.0.1:3000" }
 *          }
 *        }
 *      }
 *      ```
 *   3. Your IDE agent can now query traces:
 *      - "What failed in the last agent run?"
 *      - "How much did today's agents cost?"
 *      - "Find all tool calls that used file_read"
 *
 * The MCP server talks to AgentLens via its REST API — it does NOT
 * require any shared state or direct imports.
 */

import * as readline from 'readline';

const AGENTLENS_URL = (process.env.AGENTLENS_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');

// ─── MCP Protocol Constants ──────────────────────────────────────────────

// Updated June 2026: MCP protocol version updated
const PROTOCOL_VERSION = '2025-11-25';
const SERVER_NAME = 'agentlens';
const SERVER_VERSION = '0.1.0';

// ─── Tool Definitions ────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'agentlens_list_sessions',
    description: 'List recent agent trace sessions with status, cost, and anomaly summary. Returns the most recent sessions first.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum number of sessions to return (default: 10, max: 50)',
        },
      },
    },
  },
  {
    name: 'agentlens_get_session',
    description: 'Get full details of a specific trace session including all steps, agents, costs, and anomalies.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: {
          type: 'string',
          description: 'The session ID to retrieve',
        },
      },
      required: ['session_id'],
    },
  },
  {
    name: 'agentlens_search_traces',
    description: 'Search across all trace sessions by text query, agent name, step type, or tool name. Useful for finding specific tool calls, errors, or patterns across multiple agent runs.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Free-text search across prompts, responses, tool names, and error messages',
        },
        agent: {
          type: 'string',
          description: 'Filter by agent name (exact match)',
        },
        type: {
          type: 'string',
          description: 'Filter by step type: llm_call, tool_call, mcp_invoke, agent_spawn, decision, error',
          enum: ['llm_call', 'tool_call', 'mcp_invoke', 'agent_spawn', 'decision', 'error'],
        },
        limit: {
          type: 'number',
          description: 'Maximum results (default: 20, max: 100)',
        },
      },
    },
  },
  {
    name: 'agentlens_get_anomalies',
    description: 'Get all detected anomalies (infinite loops, high costs, empty responses, repeated prompts) across recent sessions.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum sessions to scan (default: 10)',
        },
      },
    },
  },
  {
    name: 'agentlens_get_cost_summary',
    description: 'Get a cost and token usage summary across recent sessions, broken down by agent, model, and provider.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Number of recent sessions to include (default: 10)',
        },
      },
    },
  },
];

// ─── HTTP Helpers ────────────────────────────────────────────────────────

async function fetchJSON(path: string): Promise<unknown> {
  const resp = await fetch(`${AGENTLENS_URL}${path}`);
  if (!resp.ok) {
    throw new Error(`AgentLens API error: ${resp.status} ${resp.statusText}`);
  }
  return resp.json();
}

// ─── Tool Handlers ───────────────────────────────────────────────────────

interface Session {
  id: string;
  name: string;
  status: string;
  started_at: string;
  ended_at?: string;
  agents: Array<{ name: string; total_cost: number; total_tokens: number; step_count: number; model?: string; provider?: string }>;
  total_steps: number;
  total_tokens: number;
  total_cost: number;
  total_duration_ms: number;
  anomaly_count: number;
  steps: Array<{
    agent_name: string;
    step_type: string;
    status: string;
    model?: string;
    prompt?: string;
    response?: string;
    tool_name?: string;
    error_message?: string;
    anomalies?: Array<{ type: string; severity: string; message: string }>;
    cost?: { total_cost: number };
    tokens?: { total_tokens: number };
    duration_ms: number;
  }>;
}

async function handleTool(name: string, args: Record<string, unknown>): Promise<string> {
  switch (name) {
    case 'agentlens_list_sessions': {
      const sessions = await fetchJSON('/api/ingest') as Session[];
      const limit = Math.min(Number(args.limit) || 10, 50);
      const summaries = sessions.slice(0, limit).map(s => ({
        id: s.id,
        name: s.name,
        status: s.status,
        agents: s.agents?.length || 0,
        steps: s.total_steps,
        tokens: s.total_tokens,
        cost: `$${(s.total_cost || 0).toFixed(4)}`,
        anomalies: s.anomaly_count || 0,
        started: s.started_at,
        ended: s.ended_at || 'running',
      }));
      return JSON.stringify(summaries, null, 2);
    }

    case 'agentlens_get_session': {
      const sessionId = args.session_id as string;
      const sessions = await fetchJSON('/api/ingest') as Session[];
      const session = sessions.find(s => s.id === sessionId);
      if (!session) {
        return JSON.stringify({ error: `Session '${sessionId}' not found` });
      }
      // Return a summarized view (full prompts can be huge)
      const summary = {
        id: session.id,
        name: session.name,
        status: session.status,
        started: session.started_at,
        ended: session.ended_at,
        total_cost: `$${(session.total_cost || 0).toFixed(4)}`,
        total_tokens: session.total_tokens,
        total_steps: session.total_steps,
        anomalies: session.anomaly_count,
        agents: session.agents?.map(a => ({
          name: a.name,
          steps: a.step_count,
          tokens: a.total_tokens,
          cost: `$${(a.total_cost || 0).toFixed(4)}`,
          model: a.model,
        })),
        steps: session.steps?.map(s => ({
          agent: s.agent_name,
          type: s.step_type,
          status: s.status,
          model: s.model,
          duration_ms: s.duration_ms,
          cost: s.cost?.total_cost ? `$${s.cost.total_cost.toFixed(4)}` : undefined,
          tokens: s.tokens?.total_tokens,
          tool: s.tool_name,
          error: s.error_message,
          prompt_preview: s.prompt?.substring(0, 200),
          response_preview: s.response?.substring(0, 200),
          anomalies: s.anomalies,
        })),
      };
      return JSON.stringify(summary, null, 2);
    }

    case 'agentlens_search_traces': {
      const params = new URLSearchParams();
      if (args.query) params.set('q', String(args.query));
      if (args.agent) params.set('agent', String(args.agent));
      if (args.type) params.set('type', String(args.type));
      params.set('limit', String(Math.min(Number(args.limit) || 20, 100)));
      const results = await fetchJSON(`/api/search?${params.toString()}`);
      return JSON.stringify(results, null, 2);
    }

    case 'agentlens_get_anomalies': {
      const sessions = await fetchJSON('/api/ingest') as Session[];
      const limit = Math.min(Number(args.limit) || 10, 50);
      const anomalies: Array<Record<string, unknown>> = [];

      for (const session of sessions.slice(0, limit)) {
        if (session.anomaly_count === 0) continue;
        for (const step of (session.steps || [])) {
          if (step.anomalies && step.anomalies.length > 0) {
            anomalies.push({
              session_id: session.id,
              session_name: session.name,
              agent: step.agent_name,
              step_type: step.step_type,
              anomalies: step.anomalies,
            });
          }
        }
      }
      return JSON.stringify({
        total_anomalies: anomalies.length,
        anomalies,
      }, null, 2);
    }

    case 'agentlens_get_cost_summary': {
      const sessions = await fetchJSON('/api/ingest') as Session[];
      const limit = Math.min(Number(args.limit) || 10, 50);

      let totalCost = 0;
      let totalTokens = 0;
      let totalSteps = 0;
      const byAgent: Record<string, { cost: number; tokens: number; steps: number }> = {};
      const byModel: Record<string, { cost: number; tokens: number; calls: number }> = {};

      for (const session of sessions.slice(0, limit)) {
        totalCost += session.total_cost || 0;
        totalTokens += session.total_tokens || 0;
        totalSteps += session.total_steps || 0;

        for (const agent of (session.agents || [])) {
          const key = agent.name;
          if (!byAgent[key]) byAgent[key] = { cost: 0, tokens: 0, steps: 0 };
          byAgent[key].cost += agent.total_cost || 0;
          byAgent[key].tokens += agent.total_tokens || 0;
          byAgent[key].steps += agent.step_count || 0;
        }

        for (const step of (session.steps || [])) {
          if (step.model && step.cost?.total_cost) {
            if (!byModel[step.model]) byModel[step.model] = { cost: 0, tokens: 0, calls: 0 };
            byModel[step.model].cost += step.cost.total_cost;
            byModel[step.model].tokens += step.tokens?.total_tokens || 0;
            byModel[step.model].calls += 1;
          }
        }
      }

      return JSON.stringify({
        sessions_analyzed: Math.min(sessions.length, limit),
        total_cost: `$${totalCost.toFixed(4)}`,
        total_tokens: totalTokens,
        total_steps: totalSteps,
        cost_by_agent: Object.entries(byAgent).map(([name, data]) => ({
          agent: name,
          cost: `$${data.cost.toFixed(4)}`,
          tokens: data.tokens,
          steps: data.steps,
        })).sort((a, b) => parseFloat(b.cost.slice(1)) - parseFloat(a.cost.slice(1))),
        cost_by_model: Object.entries(byModel).map(([model, data]) => ({
          model,
          cost: `$${data.cost.toFixed(4)}`,
          tokens: data.tokens,
          calls: data.calls,
        })).sort((a, b) => parseFloat(b.cost.slice(1)) - parseFloat(a.cost.slice(1))),
      }, null, 2);
    }

    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}

// ─── MCP Protocol Handler ────────────────────────────────────────────────

interface JsonRpcRequest {
  jsonrpc: string;
  id?: number | string;
  method: string;
  params?: Record<string, unknown>;
}

function sendResponse(id: number | string | undefined, result: unknown) {
  const response = {
    jsonrpc: '2.0',
    id,
    result,
  };
  process.stdout.write(JSON.stringify(response) + '\n');
}

function sendError(id: number | string | undefined, code: number, message: string) {
  const response = {
    jsonrpc: '2.0',
    id,
    error: { code, message },
  };
  process.stdout.write(JSON.stringify(response) + '\n');
}

async function handleMessage(msg: JsonRpcRequest) {
  switch (msg.method) {
    case 'initialize':
      sendResponse(msg.id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {
          tools: { listChanged: false },
        },
        serverInfo: {
          name: SERVER_NAME,
          version: SERVER_VERSION,
        },
      });
      break;

    case 'notifications/initialized':
      // No response needed for notifications
      break;

    case 'tools/list':
      sendResponse(msg.id, { tools: TOOLS });
      break;

    case 'resources/list':
      // MCP spec compliance: return empty list rather than method-not-found
      sendResponse(msg.id, { resources: [] });
      break;

    case 'prompts/list':
      // MCP spec compliance: return empty list rather than method-not-found
      sendResponse(msg.id, { prompts: [] });
      break;

    case 'tools/call': {
      const params = msg.params || {};
      const toolName = params.name as string;
      const toolArgs = (params.arguments || {}) as Record<string, unknown>;

      if (!toolName) {
        sendError(msg.id, -32602, 'Missing tool name');
        return;
      }

      try {
        const result = await handleTool(toolName, toolArgs);
        sendResponse(msg.id, {
          content: [{ type: 'text', text: result }],
        });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        sendResponse(msg.id, {
          content: [{ type: 'text', text: `Error: ${errMsg}` }],
          isError: true,
        });
      }
      break;
    }

    case 'ping':
      sendResponse(msg.id, {});
      break;

    default:
      if (msg.id !== undefined) {
        sendError(msg.id, -32601, `Method not found: ${msg.method}`);
      }
  }
}

// ─── Stdio Transport ────────────────────────────────────────────────────

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

rl.on('line', async (line: string) => {
  if (!line.trim()) return;

  try {
    const msg = JSON.parse(line) as JsonRpcRequest;
    await handleMessage(msg);
  } catch (err) {
    // Malformed JSON or handler crash — send error if we can extract an ID
    process.stderr.write(`MCP parse/handle error: ${err}\n`);
  }
});

rl.on('close', () => {
  process.exit(0);
});

// Graceful shutdown on SIGINT/SIGTERM
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    process.stderr.write(`AgentLens MCP Server shutting down (${sig})\n`);
    rl.close();
  });
}

// Log to stderr so it doesn't interfere with stdio protocol
process.stderr.write(`AgentLens MCP Server started (${AGENTLENS_URL})\n`);
