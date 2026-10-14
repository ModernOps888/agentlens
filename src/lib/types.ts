// ─── AgentLens Core Types ───────────────────────────────────────────────────

export type LLMProvider = 'openai' | 'anthropic' | 'google' | 'deepseek' | 'xai' | 'meta' | 'ollama' | 'autogen' | 'crewai' | 'langgraph' | 'adk' | 'unknown';

export type StepStatus = 'success' | 'error' | 'timeout' | 'loop_detected';

export type StepType = 'llm_call' | 'tool_call' | 'mcp_invoke' | 'agent_spawn' | 'decision' | 'error';

export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface CostBreakdown {
  input_cost: number;
  output_cost: number;
  total_cost: number;
  currency: string;
}

export interface MCPToolCall {
  server_name: string;
  tool_name: string;
  params: Record<string, unknown>;
  result: unknown;
  schema?: Record<string, unknown>;
  duration_ms: number;
  valid: boolean;
  validation_errors?: string[];
}

export interface TraceStep {
  id: string;
  session_id: string;
  agent_name: string;
  agent_color: string;
  step_index: number;
  step_type: StepType;
  status: StepStatus;
  timestamp: string;
  duration_ms: number;

  // LLM call data
  provider?: LLMProvider;
  model?: string;
  prompt?: string;
  system_prompt?: string;
  response?: string;
  temperature?: number;
  tokens?: TokenUsage;
  cost?: CostBreakdown;

  // Tool/MCP call data
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_output?: unknown;
  mcp?: MCPToolCall;

  // Agent orchestration
  parent_step_id?: string;
  child_step_ids?: string[];
  spawned_agent?: string;
  decision_reason?: string;

  // Error data
  error_message?: string;
  error_type?: string;

  // Anomaly detection
  anomalies?: Anomaly[];

  /** SimHash fingerprint of the prompt, computed pre-truncation.
   *  Used for loop detection when storePayloads is false.
   *  32-bit locality-sensitive hash — similar texts produce similar hashes. */
  promptFingerprint?: number;
}

export interface Anomaly {
  type: 'infinite_loop' | 'high_cost' | 'slow_response' | 'empty_response' | 'hallucinated_tool' | 'repeated_prompt';
  severity: 'warning' | 'critical';
  message: string;
  details?: string;
}

export interface TraceSession {
  id: string;
  name: string;
  started_at: string;
  ended_at?: string;
  status: 'running' | 'completed' | 'failed';
  agents: AgentInfo[];
  total_steps: number;
  total_tokens: number;
  total_cost: number;
  total_duration_ms: number;
  anomaly_count: number;
  steps: TraceStep[];
}

export interface AgentInfo {
  name: string;
  color: string;
  model?: string;
  provider?: LLMProvider;
  step_count: number;
  total_tokens: number;
  total_cost: number;
}

export interface SessionSummary {
  id: string;
  name: string;
  started_at: string;
  ended_at?: string;
  status: 'running' | 'completed' | 'failed';
  agent_count: number;
  total_steps: number;
  total_tokens: number;
  total_cost: number;
  anomaly_count: number;
}

// Model pricing per 1M tokens (input/output)
// Updated October 2026: frontier and open-weight model catalogs
export const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  // OpenAI Frontier & Reasoning (October 2026)
  'gpt-6-astra': { input: 10.00, output: 50.00 },
  'astra-6': { input: 10.00, output: 50.00 },
  'gpt-6-1-sol': { input: 2.00, output: 10.00 },
  'gpt-6.1-sol': { input: 2.00, output: 10.00 },
  'sol-6.1': { input: 2.00, output: 10.00 },
  'gpt-5.6-sol': { input: 3.00, output: 24.00 },
  'gpt-5.6-terra': { input: 0.60, output: 2.40 },
  'gpt-5.6-luna': { input: 0.15, output: 0.60 },
  'gpt-5.4': { input: 2.50, output: 10.00 },
  'gpt-5.4-mini': { input: 0.15, output: 0.60 },
  'gpt-5.4-nano': { input: 0.05, output: 0.20 },
  'gpt-5': { input: 2.50, output: 10.00 },
  'o1': { input: 15.00, output: 60.00 },
  'o1-mini': { input: 3.00, output: 12.00 },
  'o3': { input: 2.00, output: 8.00 },
  'o3-mini': { input: 1.10, output: 4.40 },
  'gpt-4o': { input: 2.50, output: 10.00 },
  'gpt-4o-mini': { input: 0.15, output: 0.60 },

  // Anthropic Frontier & Reasoning (October 2026)
  'claude-opus-5-5': { input: 15.00, output: 75.00 },
  'claude-opus-5.5': { input: 15.00, output: 75.00 },
  'claude-sonnet-5-5': { input: 3.00, output: 15.00 },
  'claude-sonnet-5.5': { input: 3.00, output: 15.00 },
  'claude-haiku-5-5': { input: 0.80, output: 4.00 },
  'claude-haiku-5.5': { input: 0.80, output: 4.00 },
  'claude-fable-5-1': { input: 10.00, output: 50.00 },
  'claude-fable-5.1': { input: 10.00, output: 50.00 },
  'claude-fable-5': { input: 10.00, output: 50.00 },
  'claude-mythos-5': { input: 15.00, output: 75.00 },
  'claude-sonnet-5': { input: 3.00, output: 15.00 },
  'claude-opus-4-8': { input: 15.00, output: 75.00 },
  'claude-opus-4.7': { input: 15.00, output: 75.00 },
  'claude-sonnet-4-6': { input: 3.00, output: 15.00 },
  'claude-sonnet-4.6': { input: 3.00, output: 15.00 },
  'claude-4-opus': { input: 15.00, output: 75.00 },
  'claude-4-sonnet': { input: 3.00, output: 15.00 },

  // Google DeepMind Gemini (October 2026)
  'gemini-4-argon': { input: 2.50, output: 12.00 },
  'gemini-4.0-argon': { input: 2.50, output: 12.00 },
  'gemini-3-8-pro': { input: 1.25, output: 10.00 },
  'gemini-3.8-pro': { input: 1.25, output: 10.00 },
  'gemini-3-8-flash': { input: 0.75, output: 3.75 },
  'gemini-3.8-flash': { input: 0.75, output: 3.75 },
  'gemini-3.5-flash': { input: 0.10, output: 0.40 },
  'gemini-3.1-pro': { input: 1.25, output: 10.00 },
  'gemini-2.5-pro': { input: 1.25, output: 10.00 },
  'gemini-2.5-flash': { input: 0.075, output: 0.30 },
  'gemini-2-0-pro': { input: 1.25, output: 5.00 },
  'gemini-2.0-pro': { input: 1.25, output: 5.00 },
  'gemini-2.0-flash': { input: 0.10, output: 0.40 },

  // DeepSeek (October 2026)
  'deepseek-v4-pro': { input: 0.66, output: 1.98 },
  'deepseek-chat': { input: 0.27, output: 1.10 },
  'deepseek-v3': { input: 0.27, output: 1.10 },
  'deepseek-chat-v3-0324': { input: 0.27, output: 1.10 },
  'deepseek-r1': { input: 0.55, output: 2.19 },
  'deepseek-reasoner': { input: 0.55, output: 2.19 },

  // xAI Grok (October 2026)
  'grok-4-7': { input: 3.00, output: 15.00 },
  'grok-4.7': { input: 3.00, output: 15.00 },
  'grok-4.6': { input: 2.00, output: 6.00 },
  'grok-4.5': { input: 3.00, output: 15.00 },
  'grok-4': { input: 3.00, output: 15.00 },

  // Meta & Open Frontier (October 2026)
  'muse-spark-1.3': { input: 1.25, output: 4.25 },
  'llama-3-3-70b': { input: 0.35, output: 0.40 },
  'llama-3.3-70b': { input: 0.35, output: 0.40 },
  'mistral-large': { input: 2.00, output: 6.00 },

  // Local / Ollama / SLM (free)
  'llama-3.3': { input: 0, output: 0 },
  'llama-3': { input: 0, output: 0 },
  'llama3': { input: 0, output: 0 },
  'qwen2.5-coder': { input: 0, output: 0 },
};

function resolveModelPricing(rawModel: string): { input: number; output: number } {
  if (!rawModel) return { input: 0, output: 0 };
  const lower = rawModel.trim().toLowerCase();

  // Local Ollama models (explicit prefix or :tag suffix) are free ($0)
  if (lower.startsWith('ollama/') || lower.includes(':')) {
    const stripped = lower.replace(/^[^/]+\//, '').replace(/:.*$/, '');
    if ( !lower.startsWith('ollama/') && MODEL_PRICING[stripped]) {
      return MODEL_PRICING[stripped];
    }
    return { input: 0, output: 0 };
  }

  // Strip provider prefix (e.g. "openai/gpt-6-astra") and date snapshot suffix (-YYYYMMDD or -YYYY-MM-DD)
  const normalized = lower
    .replace(/^[^/]+\//, '')
    .replace(/:.*$/, '')
    .replace(/-\d{8}$/, '')
    .replace(/-\d{4}-\d{2}-\d{2}$/, '');

  if (MODEL_PRICING[normalized]) return MODEL_PRICING[normalized];

  // Try hyphen and dot variants
  const hyphenated = normalized.replace(/\./g, '-');
  if (MODEL_PRICING[hyphenated]) return MODEL_PRICING[hyphenated];

  // Prefix-matching fallback (longest key first to avoid partial collisions)
  const keys = Object.keys(MODEL_PRICING).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (normalized.startsWith(key) || hyphenated.startsWith(key)) {
      return MODEL_PRICING[key];
    }
  }

  return { input: 0, output: 0 };
}

export function calculateCost(model: string, tokens: TokenUsage): CostBreakdown {
  const pricing = resolveModelPricing(model);
  const promptTokens = Number(tokens?.prompt_tokens) || 0;
  const completionTokens = Number(tokens?.completion_tokens) || 0;
  const input_cost = (promptTokens / 1_000_000) * pricing.input;
  const output_cost = (completionTokens / 1_000_000) * pricing.output;
  return {
    input_cost: Math.round(input_cost * 1_000_000) / 1_000_000,
    output_cost: Math.round(output_cost * 1_000_000) / 1_000_000,
    total_cost: Math.round((input_cost + output_cost) * 1_000_000) / 1_000_000,
    currency: 'USD',
  };
}
