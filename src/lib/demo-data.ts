// ─── AgentLens Demo Data ────────────────────────────────────────────────────
// A realistic multi-agent workflow: "Research & Write Blog Post"
// Agents: Orchestrator → Researcher → Writer → Editor → Publisher

import { TraceSession, TraceStep, Anomaly } from './types';

const AGENT_COLORS: Record<string, string> = {
  'Orchestrator': '#8b5cf6',  // purple
  'Researcher': '#06b6d4',    // cyan
  'Writer': '#f59e0b',        // amber
  'Editor': '#10b981',        // emerald
  'Publisher': '#ef4444',     // red
  'CodeAgent': '#3b82f6',     // blue
};

function makeStep(overrides: Partial<TraceStep> & { id: string; step_index: number; agent_name: string; step_type: TraceStep['step_type'] }): TraceStep {
  return {
    session_id: 'demo-session-001',
    agent_color: AGENT_COLORS[overrides.agent_name] || '#888',
    status: 'success',
    timestamp: new Date(Date.now() - (30 - overrides.step_index) * 4200).toISOString(),
    duration_ms: 800 + Math.random() * 2000,
    ...overrides,
  } as TraceStep;
}

const demoSteps: TraceStep[] = [
  // ── Orchestrator plans the workflow
  makeStep({
    id: 'step-001',
    step_index: 0,
    agent_name: 'Orchestrator',
    step_type: 'llm_call',
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',  // Updated June 2026: claude-4-sonnet deprecated
    system_prompt: 'You are a workflow orchestrator. Plan and coordinate multi-agent tasks.',
    prompt: 'Write a comprehensive blog post about "Why MCP is the USB-C of AI" for LinkedIn. Research current trends, write the post, edit it, and publish.',
    response: 'I will orchestrate this task in 4 phases:\n1. RESEARCH: Deploy Researcher agent to gather current MCP trends, adoption data, and key players\n2. WRITE: Deploy Writer agent with research context to draft the blog post\n3. EDIT: Deploy Editor agent to refine tone, check facts, and optimize for LinkedIn\n4. PUBLISH: Deploy Publisher agent to format and schedule\n\nSpawning Researcher agent now...',
    temperature: 0.3,
    tokens: { prompt_tokens: 342, completion_tokens: 187, total_tokens: 529 },
    cost: { input_cost: 0.0010, output_cost: 0.0028, total_cost: 0.0038, currency: 'USD' },
    duration_ms: 1240,
    child_step_ids: ['step-002'],
    spawned_agent: 'Researcher',
  }),

  // ── Orchestrator spawns Researcher
  makeStep({
    id: 'step-002',
    step_index: 1,
    agent_name: 'Orchestrator',
    step_type: 'agent_spawn',
    spawned_agent: 'Researcher',
    decision_reason: 'Phase 1: Research current MCP ecosystem trends',
    duration_ms: 45,
    parent_step_id: 'step-001',
  }),

  // ── Researcher: MCP search via tool
  makeStep({
    id: 'step-003',
    step_index: 2,
    agent_name: 'Researcher',
    step_type: 'mcp_invoke',
    mcp: {
      server_name: 'web-search',
      tool_name: 'search',
      params: { query: 'MCP Model Context Protocol adoption 2026 statistics enterprise', max_results: 10 },
      result: {
        results: [
          { title: 'MCP Hits 50,000 GitHub Stars', url: 'https://github.com/modelcontextprotocol', snippet: 'The Model Context Protocol has seen explosive adoption...' },
          { title: 'Linux Foundation Adopts MCP Standard', url: 'https://linuxfoundation.org/mcp', snippet: 'Major milestone as MCP joins the Agentic AI Foundation...' },
          { title: '87% of Enterprise AI Teams Now Use MCP', url: 'https://techcrunch.com/mcp-enterprise', snippet: 'Survey reveals unprecedented adoption rate...' },
        ]
      },
      schema: { type: 'object', properties: { query: { type: 'string' }, max_results: { type: 'number' } } },
      duration_ms: 2340,
      valid: true,
    },
    duration_ms: 2340,
    parent_step_id: 'step-002',
  }),

  // ── Researcher: Scrape article
  makeStep({
    id: 'step-004',
    step_index: 3,
    agent_name: 'Researcher',
    step_type: 'mcp_invoke',
    mcp: {
      server_name: 'firecrawl',
      tool_name: 'scrape_url',
      params: { url: 'https://techcrunch.com/mcp-enterprise', format: 'markdown' },
      result: { content: '# 87% of Enterprise AI Teams Now Use MCP\n\nA comprehensive survey by Gartner reveals that MCP adoption has surged from 12% to 87% in just 18 months. Key findings:\n\n- 94% of teams report reduced integration time\n- Average 3.2x faster agent deployment\n- 67% reduction in "connector maintenance" overhead\n\nThe protocol, originally created by Anthropic, has evolved beyond its origins into a true industry standard...' },
      schema: { type: 'object', properties: { url: { type: 'string' }, format: { type: 'string' } } },
      duration_ms: 3100,
      valid: true,
    },
    duration_ms: 3100,
    parent_step_id: 'step-002',
  }),

  // ── Researcher: Synthesize findings
  makeStep({
    id: 'step-005',
    step_index: 4,
    agent_name: 'Researcher',
    step_type: 'llm_call',
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',  // Updated June 2026: claude-4-sonnet deprecated
    prompt: 'Synthesize these research findings into a structured brief for a blog post writer. Focus on: key statistics, analogies to USB-C, enterprise adoption drivers, and community growth.',
    response: '## Research Brief: MCP as "USB-C of AI"\n\n### Key Statistics\n- 50,000+ GitHub stars (400% growth YoY)\n- 87% enterprise adoption (Gartner 2026)\n- 94% report reduced integration time\n- 3.2x faster agent deployment\n- 67% reduction in connector maintenance\n\n### The USB-C Analogy\n- Before MCP: N×M problem (every model needs custom connector to every tool)\n- After MCP: N+M solution (one standard protocol, universal compatibility)\n- Like USB-C replaced a drawer full of cables, MCP replaces a codebase full of bespoke integrations\n\n### Enterprise Drivers\n1. Linux Foundation backing (trust signal)\n2. Major vendor support (Anthropic, Google, Microsoft, AWS)\n3. Security: centralized audit trails vs scattered API keys\n4. Cost: one integration serves all current and future models\n\n### Community Growth\n- 2,400+ community MCP servers on MCPMarket\n- FastMCP framework: Python server in 20 lines of code\n- Official servers for: GitHub, Postgres, Slack, Google Workspace, Notion',
    tokens: { prompt_tokens: 1850, completion_tokens: 620, total_tokens: 2470 },
    cost: { input_cost: 0.0056, output_cost: 0.0093, total_cost: 0.0149, currency: 'USD' },
    duration_ms: 2890,
    parent_step_id: 'step-002',
  }),

  // ── Orchestrator: Decision to spawn Writer
  makeStep({
    id: 'step-006',
    step_index: 5,
    agent_name: 'Orchestrator',
    step_type: 'decision',
    decision_reason: 'Research phase complete. Quality score: 9/10. Proceeding to Phase 2: Writing.',
    duration_ms: 320,
    spawned_agent: 'Writer',
    child_step_ids: ['step-007'],
  }),

  // ── Orchestrator spawns Writer
  makeStep({
    id: 'step-007',
    step_index: 6,
    agent_name: 'Orchestrator',
    step_type: 'agent_spawn',
    spawned_agent: 'Writer',
    decision_reason: 'Phase 2: Draft blog post with research context',
    duration_ms: 38,
    parent_step_id: 'step-006',
  }),

  // ── Writer: Draft blog post
  makeStep({
    id: 'step-008',
    step_index: 7,
    agent_name: 'Writer',
    step_type: 'llm_call',
    provider: 'openai',
    model: 'gpt-5.4',  // Updated June 2026: gpt-4o deprecated
    system_prompt: 'You are a viral LinkedIn content writer. Write engaging, scannable posts that drive comments and shares. Use the hook-value-CTA framework.',
    prompt: 'Write a LinkedIn blog post based on this research brief. Target audience: AI developers and engineering leaders. Make it go viral.\n\n[Research Brief attached]',
    response: '🔌 Remember when you needed 7 different cables for your devices?\n\nThat was AI integration 18 months ago.\n\nEvery model needed its own custom connector to every tool. OpenAI → GitHub? Custom code. Claude → Slack? Another integration. Gemini → your database? Start from scratch.\n\nN models × M tools = engineering nightmare.\n\nThen MCP changed everything.\n\nThe Model Context Protocol is the USB-C moment for AI. One standard. Universal compatibility. And the numbers are staggering:\n\n📊 87% of enterprise AI teams now use MCP (Gartner 2026)\n📊 94% report reduced integration time\n📊 3.2x faster agent deployment\n📊 67% less "connector maintenance"\n\nThink about what that means:\n\nYou build ONE MCP server for your database.\nEvery AI model—current and future—can use it.\nNo more rewriting integrations when you switch providers.\n\nThe Linux Foundation backing sealed it. Microsoft, Google, AWS, Anthropic—all committed.\n\n2,400+ community servers already exist.\nYou can build your own in 20 lines of Python.\n\nThe N×M problem is solved. We\'re in N+M territory now.\n\nIf your team is still building custom AI integrations in 2026, you\'re maintaining a drawer full of proprietary cables in a USB-C world.\n\n---\n\n♻️ Repost if your team has made the switch\n💬 Comment: What was your worst "custom integration" horror story?',
    tokens: { prompt_tokens: 2100, completion_tokens: 890, total_tokens: 2990 },
    cost: { input_cost: 0.0053, output_cost: 0.0089, total_cost: 0.0142, currency: 'USD' },
    duration_ms: 4200,
    parent_step_id: 'step-007',
  }),

  // ── Orchestrator: Decision to spawn Editor
  makeStep({
    id: 'step-009',
    step_index: 8,
    agent_name: 'Orchestrator',
    step_type: 'decision',
    decision_reason: 'Draft complete. Engagement score prediction: 8.5/10. Spawning Editor for refinement.',
    duration_ms: 280,
    spawned_agent: 'Editor',
  }),

  // ── Editor: Fact-check via MCP
  makeStep({
    id: 'step-010',
    step_index: 9,
    agent_name: 'Editor',
    step_type: 'mcp_invoke',
    mcp: {
      server_name: 'web-search',
      tool_name: 'search',
      params: { query: 'Gartner MCP adoption 87% 2026 verify source', max_results: 5 },
      result: {
        results: [
          { title: 'Gartner: MCP Enterprise Adoption Report 2026', url: 'https://gartner.com/mcp-2026', snippet: 'Confirmed: 87% adoption rate across surveyed enterprise AI teams...' }
        ]
      },
      schema: { type: 'object', properties: { query: { type: 'string' } } },
      duration_ms: 1800,
      valid: true,
    },
    duration_ms: 1800,
  }),

  // ── Editor: Refine the post
  makeStep({
    id: 'step-011',
    step_index: 10,
    agent_name: 'Editor',
    step_type: 'llm_call',
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',  // Updated June 2026: claude-4-sonnet deprecated
    prompt: 'Review and refine this LinkedIn post for:\n1. Fact accuracy (verified: 87% stat is confirmed)\n2. LinkedIn algorithm optimization (no external links in body)\n3. Hook strength (first 2 lines must force "See More")\n4. Comment-driving CTA\n5. Readability (short paragraphs, white space)',
    response: 'The post is strong. Refinements made:\n\n✅ Hook: Opening metaphor is excellent — creates instant recognition\n✅ Stats: All verified, properly attributed\n✅ Structure: Great use of white space and emoji anchors\n✅ CTA: Dual CTA (repost + comment) maximizes engagement\n\nMinor edits:\n- Shortened paragraph 3 for better mobile readability\n- Added "👇" before the comment CTA to increase visual pull\n- Removed one redundant stat to keep it under 1,300 characters\n\nEngagement prediction: 9.2/10\nEstimated reach: 15,000-45,000 impressions',
    tokens: { prompt_tokens: 1200, completion_tokens: 340, total_tokens: 1540 },
    cost: { input_cost: 0.0036, output_cost: 0.0051, total_cost: 0.0087, currency: 'USD' },
    duration_ms: 1650,
  }),

  // ── Publisher: Format for posting
  makeStep({
    id: 'step-012',
    step_index: 11,
    agent_name: 'Publisher',
    step_type: 'mcp_invoke',
    mcp: {
      server_name: 'linkedin-api',
      tool_name: 'create_draft',
      params: { content: '[Final post content]', visibility: 'public', schedule: '2026-04-10T09:00:00Z' },
      result: { draft_id: 'li-draft-8472', status: 'scheduled', scheduled_for: '2026-04-10T09:00:00Z' },
      schema: { type: 'object', properties: { content: { type: 'string' }, visibility: { type: 'string' }, schedule: { type: 'string' } } },
      duration_ms: 890,
      valid: true,
    },
    duration_ms: 890,
  }),

  // ── Orchestrator: Final summary
  makeStep({
    id: 'step-013',
    step_index: 12,
    agent_name: 'Orchestrator',
    step_type: 'llm_call',
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',  // Updated June 2026: claude-4-sonnet deprecated
    prompt: 'Summarize the workflow completion status.',
    response: '✅ WORKFLOW COMPLETE\n\n📋 Summary:\n- Research: 3 sources analyzed, brief generated\n- Writing: 1,247 character post drafted (optimal length)\n- Editing: Facts verified, engagement score 9.2/10\n- Publishing: Scheduled for Apr 10, 9:00 AM UTC\n\n💰 Total cost: $0.0416\n⏱️ Total time: 18.5 seconds\n🔗 13 steps across 5 agents\n\nAll phases completed successfully.',
    tokens: { prompt_tokens: 380, completion_tokens: 210, total_tokens: 590 },
    cost: { input_cost: 0.0011, output_cost: 0.0032, total_cost: 0.0043, currency: 'USD' },
    duration_ms: 980,
  }),
];

// ── Second demo session: a FAILED workflow with anomalies
const failedSteps: TraceStep[] = [
  makeStep({
    id: 'fail-001',
    session_id: 'demo-session-002',
    step_index: 0,
    agent_name: 'CodeAgent',
    step_type: 'llm_call',
    provider: 'openai',
    model: 'gpt-5.4',  // Updated June 2026: gpt-4o deprecated
    prompt: 'Refactor the authentication module to use OAuth2 with PKCE flow.',
    response: 'I\'ll start by examining the current auth module and planning the refactor...',
    tokens: { prompt_tokens: 450, completion_tokens: 180, total_tokens: 630 },
    cost: { input_cost: 0.0011, output_cost: 0.0018, total_cost: 0.0029, currency: 'USD' },
    duration_ms: 1100,
  }),
  makeStep({
    id: 'fail-002',
    session_id: 'demo-session-002',
    step_index: 1,
    agent_name: 'CodeAgent',
    step_type: 'tool_call',
    tool_name: 'read_file',
    tool_input: { path: 'src/auth/handler.ts' },
    tool_output: { content: 'export class AuthHandler { ... }' },
    duration_ms: 45,
  }),
  makeStep({
    id: 'fail-003',
    session_id: 'demo-session-002',
    step_index: 2,
    agent_name: 'CodeAgent',
    step_type: 'llm_call',
    provider: 'openai',
    model: 'gpt-5.4',  // Updated June 2026: gpt-4o deprecated
    prompt: 'Now refactor handler.ts to implement PKCE flow...',
    response: 'Let me update the file with the new OAuth2 PKCE implementation...',
    tokens: { prompt_tokens: 1200, completion_tokens: 890, total_tokens: 2090 },
    cost: { input_cost: 0.0030, output_cost: 0.0089, total_cost: 0.0119, currency: 'USD' },
    duration_ms: 3200,
  }),
  makeStep({
    id: 'fail-004',
    session_id: 'demo-session-002',
    step_index: 3,
    agent_name: 'CodeAgent',
    step_type: 'tool_call',
    tool_name: 'write_file',
    tool_input: { path: 'src/auth/handler.ts', content: '...' },
    tool_output: { success: true },
    duration_ms: 30,
  }),
  makeStep({
    id: 'fail-005',
    session_id: 'demo-session-002',
    step_index: 4,
    agent_name: 'CodeAgent',
    step_type: 'tool_call',
    tool_name: 'run_tests',
    tool_input: { pattern: 'auth/**/*.test.ts' },
    tool_output: { passed: 0, failed: 3, errors: ['PKCE verifier mismatch', 'Missing redirect_uri', 'Token refresh loop'] },
    status: 'error',
    error_message: '3 tests failed',
    error_type: 'TestFailure',
    duration_ms: 2100,
  }),
  // ── LOOP STARTS: Agent keeps trying the same fix
  makeStep({
    id: 'fail-006',
    session_id: 'demo-session-002',
    step_index: 5,
    agent_name: 'CodeAgent',
    step_type: 'llm_call',
    provider: 'openai',
    model: 'gpt-5.4',  // Updated June 2026: gpt-4o deprecated
    prompt: 'Tests failed. Fix the PKCE verifier mismatch error.',
    response: 'I see the issue — the code verifier needs to be stored before the challenge is generated...',
    tokens: { prompt_tokens: 2800, completion_tokens: 950, total_tokens: 3750 },
    cost: { input_cost: 0.0070, output_cost: 0.0095, total_cost: 0.0165, currency: 'USD' },
    duration_ms: 3800,
    anomalies: [{ type: 'repeated_prompt', severity: 'warning', message: 'Similar prompt detected (85% match with step 2)', details: 'Agent may be stuck in a fix-test loop' }],
  }),
  makeStep({
    id: 'fail-007',
    session_id: 'demo-session-002',
    step_index: 6,
    agent_name: 'CodeAgent',
    step_type: 'tool_call',
    tool_name: 'write_file',
    tool_input: { path: 'src/auth/handler.ts', content: '...' },
    tool_output: { success: true },
    duration_ms: 28,
  }),
  makeStep({
    id: 'fail-008',
    session_id: 'demo-session-002',
    step_index: 7,
    agent_name: 'CodeAgent',
    step_type: 'tool_call',
    tool_name: 'run_tests',
    tool_input: { pattern: 'auth/**/*.test.ts' },
    tool_output: { passed: 1, failed: 2, errors: ['Missing redirect_uri', 'Token refresh loop'] },
    status: 'error',
    error_message: '2 tests still failing',
    error_type: 'TestFailure',
    duration_ms: 1900,
  }),
  makeStep({
    id: 'fail-009',
    session_id: 'demo-session-002',
    step_index: 8,
    agent_name: 'CodeAgent',
    step_type: 'llm_call',
    provider: 'openai',
    model: 'gpt-5.4',  // Updated June 2026: gpt-4o deprecated
    prompt: 'Still 2 tests failing. Fix: Missing redirect_uri and Token refresh loop.',
    response: 'The redirect_uri needs to be passed in the initial authorization request...',
    tokens: { prompt_tokens: 4200, completion_tokens: 1100, total_tokens: 5300 },
    cost: { input_cost: 0.0105, output_cost: 0.0110, total_cost: 0.0215, currency: 'USD' },
    duration_ms: 5200,
    anomalies: [
      { type: 'infinite_loop', severity: 'critical', message: 'Loop detected: 3 consecutive fix→test→fail cycles', details: 'Agent has entered a fix-test loop pattern. Total loop cost: $0.0499' },
      { type: 'high_cost', severity: 'warning', message: 'Token usage escalating: 5,300 tokens (2.1x increase from step 5)', details: 'Context window growing as failed attempts accumulate' },
    ],
  }),
  makeStep({
    id: 'fail-010',
    session_id: 'demo-session-002',
    step_index: 9,
    agent_name: 'CodeAgent',
    step_type: 'error',
    status: 'loop_detected',
    error_message: 'AgentLens: Automatic loop detection triggered. Agent halted after 3 fix→test→fail cycles.',
    error_type: 'LoopDetection',
    duration_ms: 1,
    anomalies: [{ type: 'infinite_loop', severity: 'critical', message: 'Workflow terminated: Agent was stuck in an infinite fix-test loop', details: 'Total cost before halt: $0.0528 across 10 steps. Without detection, estimated cost at 50 iterations: $2.64' }],
  }),
];

export const demoSessions: TraceSession[] = [
  {
    id: 'demo-session-001',
    name: 'LinkedIn Blog Post Pipeline',
    started_at: new Date(Date.now() - 120000).toISOString(),
    ended_at: new Date(Date.now() - 98000).toISOString(),
    status: 'completed',
    agents: [
      { name: 'Orchestrator', color: '#8b5cf6', model: 'claude-sonnet-4-6', provider: 'anthropic', step_count: 4, total_tokens: 1119, total_cost: 0.0081 },  // Updated June 2026: model deprecated
      { name: 'Researcher', color: '#06b6d4', model: 'claude-sonnet-4-6', provider: 'anthropic', step_count: 3, total_tokens: 2470, total_cost: 0.0149 },  // Updated June 2026: model deprecated
      { name: 'Writer', color: '#f59e0b', model: 'gpt-5.4', provider: 'openai', step_count: 1, total_tokens: 2990, total_cost: 0.0142 },  // Updated June 2026: model deprecated
      { name: 'Editor', color: '#10b981', model: 'claude-sonnet-4-6', provider: 'anthropic', step_count: 2, total_tokens: 1540, total_cost: 0.0087 },  // Updated June 2026: model deprecated
      { name: 'Publisher', color: '#ef4444', provider: 'anthropic', step_count: 1, total_tokens: 0, total_cost: 0 },
    ],
    total_steps: 13,
    total_tokens: 8709,
    total_cost: 0.0459,
    total_duration_ms: 18553,
    anomaly_count: 0,
    steps: demoSteps,
  },
  {
    id: 'demo-session-002',
    name: 'OAuth2 PKCE Refactor ⚠️',
    started_at: new Date(Date.now() - 300000).toISOString(),
    ended_at: new Date(Date.now() - 270000).toISOString(),
    status: 'failed',
    agents: [
      { name: 'CodeAgent', color: '#3b82f6', model: 'gpt-5.4', provider: 'openai', step_count: 10, total_tokens: 12400, total_cost: 0.0528 },  // Updated June 2026: model deprecated
    ],
    total_steps: 10,
    total_tokens: 12400,
    total_cost: 0.0528,
    total_duration_ms: 18404,
    anomaly_count: 4,
    steps: failedSteps,
  },
];

export function getDemoSessions(): TraceSession[] {
  return demoSessions;
}

export function getDemoSession(id: string): TraceSession | undefined {
  return demoSessions.find(s => s.id === id);
}
