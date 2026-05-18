// ─── AgentLens Core Types ───────────────────────────────────────────────────

export type LLMProvider = 'openai' | 'anthropic' | 'google' | 'ollama' | 'unknown';

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

// Model pricing per 1M tokens (input/output) — updated May 2026
export const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  // OpenAI
  'gpt-5.4': { input: 2.50, output: 10.00 },
  'gpt-5.4-mini': { input: 0.15, output: 0.60 },
  'gpt-5.4-nano': { input: 0.05, output: 0.20 },
  'gpt-4o': { input: 2.50, output: 10.00 },
  'gpt-4o-mini': { input: 0.15, output: 0.60 },
  'gpt-4-turbo': { input: 10.00, output: 30.00 },
  'gpt-4': { input: 30.00, output: 60.00 },
  'gpt-3.5-turbo': { input: 0.50, output: 1.50 },
  // Anthropic
  'claude-opus-4.7': { input: 15.00, output: 75.00 },
  'claude-sonnet-4.6': { input: 3.00, output: 15.00 },
  'claude-3-opus': { input: 15.00, output: 75.00 },
  'claude-3.5-sonnet': { input: 3.00, output: 15.00 },
  'claude-3-haiku': { input: 0.25, output: 1.25 },
  'claude-4-opus': { input: 15.00, output: 75.00 },
  'claude-4-sonnet': { input: 3.00, output: 15.00 },
  // Google
  'gemini-2.5-pro': { input: 1.25, output: 10.00 },
  'gemini-2.5-flash': { input: 0.075, output: 0.30 },
  'gemini-2.0-flash': { input: 0.10, output: 0.40 },
  'gemini-2.0-pro': { input: 1.25, output: 5.00 },
  // DeepSeek
  'deepseek-chat-v3-0324': { input: 0.27, output: 1.10 },
  'deepseek-r1': { input: 0.55, output: 2.19 },
  // Open / Local (free)
  'llama-3': { input: 0, output: 0 },
  'qwen2.5-coder': { input: 0, output: 0 },
  'mistral-large': { input: 2.00, output: 6.00 },
};

export function calculateCost(model: string, tokens: TokenUsage): CostBreakdown {
  const pricing = MODEL_PRICING[model] || { input: 0, output: 0 };
  const input_cost = (tokens.prompt_tokens / 1_000_000) * pricing.input;
  const output_cost = (tokens.completion_tokens / 1_000_000) * pricing.output;
  return {
    input_cost: Math.round(input_cost * 10000) / 10000,
    output_cost: Math.round(output_cost * 10000) / 10000,
    total_cost: Math.round((input_cost + output_cost) * 10000) / 10000,
    currency: 'USD',
  };
}
