// ─── Storage Configuration ──────────────────────────────────────────────────
// Production-grade controls for sampling, TTL, and storage limits.
// Includes JSON file-based persistence so traces survive server restarts.

import type { TraceSession, TraceStep, CostBreakdown } from './types';
import { calculateCost } from './types';
import * as fs from 'fs';
import * as path from 'path';

/** Raw ingest payload from the SDK — loosely typed to accept any field */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RawStep = Record<string, any>;

/** Agent color palette for visual differentiation */
const AGENT_COLORS = [
  '#06b6d4', '#8b5cf6', '#f59e0b', '#10b981', '#ef4444',
  '#ec4899', '#3b82f6', '#14b8a6', '#f97316', '#6366f1',
  '#84cc16', '#a855f7', '#22d3ee', '#fb923c', '#4ade80',
];

// ─── Persistence Paths ──────────────────────────────────────────────────────
const DATA_DIR = path.resolve(process.cwd(), '.data');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');

export interface StorageConfig {
  /** Sampling rate: 0.0–1.0. 1.0 = capture everything, 0.1 = capture 10%.
   *  Anomalies and errors are ALWAYS captured regardless of sampling rate. */
  samplingRate: number;

  /** Time-to-live in milliseconds. Sessions older than this are auto-purged.
   *  Default: 24 hours. Set to 0 for unlimited. */
  ttlMs: number;

  /** Maximum number of sessions to keep. Oldest sessions are evicted first.
   *  Default: 100. Set to 0 for unlimited. */
  maxSessions: number;

  /** Maximum steps per session. Beyond this, only anomalies/errors are kept.
   *  Default: 500. Set to 0 for unlimited. */
  maxStepsPerSession: number;

  /** Whether to store full prompt/response payloads.
   *  Set to false in production to cut storage 10-20x.
   *  Cost/token data is always stored regardless. */
  storePayloads: boolean;

  /** Max characters to store per prompt/response when storePayloads is true.
   *  Truncates long payloads. Default: 2000. Set to 0 for unlimited. */
  maxPayloadChars: number;

  /** Auto-cleanup interval in milliseconds. Default: 60000 (1 min). */
  cleanupIntervalMs: number;

  /** Debounce interval for disk writes in milliseconds.
   *  Prevents excessive I/O during burst ingestion. Default: 500ms. */
  persistDebounceMs: number;
}

const DEFAULT_CONFIG: StorageConfig = {
  samplingRate: 1.0,       // capture everything (dev mode)
  ttlMs: 24 * 60 * 60 * 1000, // 24 hours
  maxSessions: 100,
  maxStepsPerSession: 500,
  storePayloads: true,
  maxPayloadChars: 2000,
  cleanupIntervalMs: 60000,
  persistDebounceMs: 500,
};

class TraceStore {
  private sessions: Map<string, TraceSession> = new Map();
  private agentColorMap: Map<string, string> = new Map();
  private colorIndex = 0;
  private listeners: Set<(event: string, data: unknown) => void> = new Set();
  private config: StorageConfig;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private sampledOutSessions: Set<string> = new Set();
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private persistDirty = false;

  /** Stats for monitoring storage health */
  public stats = {
    totalIngestedSteps: 0,
    totalDroppedBySampling: 0,
    totalDroppedByTTL: 0,
    totalTruncatedPayloads: 0,
  };

  constructor(config?: Partial<StorageConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.hydrateFromDisk();
    this.startCleanupLoop();
  }

  // ─── Disk Persistence ───────────────────────────────────────────────────

  /** Hydrate sessions from disk on startup */
  private hydrateFromDisk() {
    try {
      if (!fs.existsSync(SESSIONS_FILE)) return;

      const raw = fs.readFileSync(SESSIONS_FILE, 'utf-8');
      const data = JSON.parse(raw) as {
        sessions: Array<[string, TraceSession]>;
        agentColors: Array<[string, string]>;
        colorIndex: number;
      };

      if (data.sessions && Array.isArray(data.sessions)) {
        this.sessions = new Map(data.sessions);
      }
      if (data.agentColors && Array.isArray(data.agentColors)) {
        this.agentColorMap = new Map(data.agentColors);
      }
      if (typeof data.colorIndex === 'number') {
        this.colorIndex = data.colorIndex;
      }

      console.log(`[AgentLens] Hydrated ${this.sessions.size} sessions from disk`);
    } catch (err) {
      console.warn('[AgentLens] Failed to hydrate from disk, starting fresh:', err);
    }
  }

  /** Schedule a debounced write to disk */
  private schedulePersist() {
    this.persistDirty = true;
    if (this.persistTimer) return; // already scheduled

    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      if (this.persistDirty) {
        this.persistToDisk();
        this.persistDirty = false;
      }
    }, this.config.persistDebounceMs);
  }

  /** Synchronously write current state to disk */
  private persistToDisk() {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }

      const data = {
        sessions: Array.from(this.sessions.entries()),
        agentColors: Array.from(this.agentColorMap.entries()),
        colorIndex: this.colorIndex,
        savedAt: new Date().toISOString(),
      };

      // Atomic write: write to temp file then rename
      const tmpFile = SESSIONS_FILE + '.tmp';
      fs.writeFileSync(tmpFile, JSON.stringify(data), 'utf-8');
      fs.renameSync(tmpFile, SESSIONS_FILE);
    } catch (err) {
      console.error('[AgentLens] Failed to persist to disk:', err);
    }
  }

  /** Force an immediate flush to disk (useful before shutdown) */
  flushToDisk() {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    this.persistToDisk();
    this.persistDirty = false;
  }

  /** Update configuration at runtime */
  configure(updates: Partial<StorageConfig>) {
    this.config = { ...this.config, ...updates };
    // Restart cleanup loop with new interval
    this.startCleanupLoop();
  }

  /** Get current configuration */
  getConfig(): StorageConfig {
    return { ...this.config };
  }

  /** Get storage stats */
  getStats() {
    return {
      ...this.stats,
      activeSessions: this.sessions.size,
      totalStepsStored: Array.from(this.sessions.values()).reduce((s, sess) => s + sess.steps.length, 0),
      activeListeners: this.listeners.size,
    };
  }

  private startCleanupLoop() {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    if (this.config.cleanupIntervalMs > 0) {
      this.cleanupTimer = setInterval(() => this.cleanup(), this.config.cleanupIntervalMs);
    }
  }

  /** Remove expired sessions (TTL) and enforce maxSessions */
  cleanup() {
    const now = Date.now();
    let purgedCount = 0;

    // TTL expiry
    if (this.config.ttlMs > 0) {
      for (const [id, session] of this.sessions) {
        const sessionAge = now - new Date(session.started_at).getTime();
        if (sessionAge > this.config.ttlMs) {
          this.sessions.delete(id);
          purgedCount++;
        }
      }
    }

    // Max sessions enforcement (evict oldest)
    if (this.config.maxSessions > 0 && this.sessions.size > this.config.maxSessions) {
      const sorted = Array.from(this.sessions.entries())
        .sort((a, b) => new Date(a[1].started_at).getTime() - new Date(b[1].started_at).getTime());

      const toRemove = sorted.slice(0, this.sessions.size - this.config.maxSessions);
      for (const [id] of toRemove) {
        this.sessions.delete(id);
        purgedCount++;
      }
    }

    this.stats.totalDroppedByTTL += purgedCount;

    if (purgedCount > 0) {
      this.emit('storage:cleanup', { purged: purgedCount, remaining: this.sessions.size });
      this.schedulePersist();
    }

    // Prune stale sampled-out session IDs to prevent unbounded Set growth
    this.pruneSampledOutSessions();
  }

  /** Determine if a session should be sampled (captured) */
  private shouldSample(sessionId: string, raw: RawStep): boolean {
    // Always capture errors and anomalous sessions  
    if (raw.status === 'error' || raw.error_message) return true;

    // If we already decided to drop this session, keep dropping
    if (this.sampledOutSessions.has(sessionId)) return false;

    // If session already exists, continue capturing it
    if (this.sessions.has(sessionId)) return true;

    // New session — apply sampling rate
    if (this.config.samplingRate >= 1.0) return true;
    if (this.config.samplingRate <= 0) {
      this.sampledOutSessions.add(sessionId);
      return false;
    }

    const sampled = Math.random() < this.config.samplingRate;
    if (!sampled) {
      this.sampledOutSessions.add(sessionId);
    }
    return sampled;
  }

  /** Truncate a string payload to configured max length */
  private truncatePayload(text: string | undefined): string | undefined {
    if (!text) return text;
    if (!this.config.storePayloads) {
      this.stats.totalTruncatedPayloads++;
      return undefined; // Strip payload entirely
    }
    if (this.config.maxPayloadChars > 0 && text.length > this.config.maxPayloadChars) {
      this.stats.totalTruncatedPayloads++;
      return text.substring(0, this.config.maxPayloadChars) + `... [truncated at ${this.config.maxPayloadChars} chars]`;
    }
    return text;
  }

  /** Subscribe to real-time trace events */
  subscribe(listener: (event: string, data: unknown) => void) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private emit(event: string, data: unknown) {
    this.listeners.forEach(fn => fn(event, data));
  }

  getAgentColor(agentName: string): string {
    if (!this.agentColorMap.has(agentName)) {
      this.agentColorMap.set(agentName, AGENT_COLORS[this.colorIndex % AGENT_COLORS.length]);
      this.colorIndex++;
    }
    return this.agentColorMap.get(agentName)!;
  }

  ingestStep(raw: RawStep): TraceStep {
    const sessionId = raw.session_id;
    const now = new Date().toISOString();
    this.stats.totalIngestedSteps++;

    // ─── Sampling gate ──────────────────────────────────────────────────
    if (!this.shouldSample(sessionId, raw)) {
      this.stats.totalDroppedBySampling++;
      // Return a minimal step (not stored) so the SDK doesn't break
      return {
        id: `${sessionId}-dropped`,
        session_id: sessionId,
        agent_name: raw.agent_name,
        agent_color: '#666',
        step_index: -1,
        step_type: (raw.step_type || 'llm_call') as TraceStep['step_type'],
        status: 'success' as TraceStep['status'],
        timestamp: now,
        duration_ms: 0,
      };
    }

    // ─── Fingerprint BEFORE truncation (for loop detection) ────────────
    const promptFingerprint = raw.prompt ? this.computeSimHash(raw.prompt) : undefined;

    // ─── Payload truncation ─────────────────────────────────────────────
    raw.prompt = this.truncatePayload(raw.prompt);
    raw.system_prompt = this.truncatePayload(raw.system_prompt);
    raw.response = this.truncatePayload(raw.response);

    // Create session if it doesn't exist
    const isNewSession = !this.sessions.has(sessionId);
    if (isNewSession) {
      this.sessions.set(sessionId, {
        id: sessionId,
        name: raw.session_name || `Session ${sessionId.substring(0, 8)}`,
        started_at: now,
        status: 'running',
        agents: [],
        total_steps: 0,
        total_tokens: 0,
        total_cost: 0,
        total_duration_ms: 0,
        anomaly_count: 0,
        steps: [],
      });
    }

    const session = this.sessions.get(sessionId)!;

    // Auto-calculate cost if tokens and model provided
    let cost: CostBreakdown | undefined;
    if (raw.tokens && raw.model) {
      cost = calculateCost(raw.model, raw.tokens);
    }

    // Build the step
    const step: TraceStep = {
      id: `${sessionId}-step-${session.total_steps}`,
      session_id: sessionId,
      agent_name: raw.agent_name,
      agent_color: this.getAgentColor(raw.agent_name),
      step_index: session.total_steps,
      step_type: (raw.step_type || 'llm_call') as TraceStep['step_type'],
      status: (raw.status || 'success') as TraceStep['status'],
      timestamp: raw.timestamp || now,
      duration_ms: raw.duration_ms || 0,
      provider: raw.provider as TraceStep['provider'],
      model: raw.model,
      prompt: raw.prompt,
      system_prompt: raw.system_prompt,
      response: raw.response,
      temperature: raw.temperature,
      tokens: raw.tokens,
      cost,
      tool_name: raw.tool_name,
      tool_input: raw.tool_input,
      tool_output: raw.tool_output,
      spawned_agent: raw.spawned_agent,
      decision_reason: raw.decision_reason,
      error_message: raw.error_message,
      error_type: raw.error_type,
      anomalies: [],
      promptFingerprint,
    };

    // Build MCP data if present
    if (raw.mcp_server && raw.mcp_tool) {
      step.mcp = {
        server_name: raw.mcp_server,
        tool_name: raw.mcp_tool,
        params: raw.mcp_params || {},
        result: raw.mcp_result,
        duration_ms: raw.duration_ms || 0,
        valid: true,
      };
    }

    // Add step to session (with maxStepsPerSession enforcement)
    const overStepLimit = this.config.maxStepsPerSession > 0 &&
      session.steps.length >= this.config.maxStepsPerSession;
    const isImportantStep = step.status === 'error' || (step.anomalies && step.anomalies.length > 0);

    if (!overStepLimit || isImportantStep) {
      session.steps.push(step);
    }
    // Always update counters even if step was dropped from storage
    session.total_steps++;
    session.total_duration_ms += step.duration_ms;
    if (step.tokens) {
      session.total_tokens += step.tokens.total_tokens;
    }
    if (cost) {
      session.total_cost += cost.total_cost;
    }

    // Update agent info
    let agentInfo = session.agents.find(a => a.name === step.agent_name);
    if (!agentInfo) {
      agentInfo = {
        name: step.agent_name,
        color: step.agent_color,
        model: step.model,
        provider: step.provider,
        step_count: 0,
        total_tokens: 0,
        total_cost: 0,
      };
      session.agents.push(agentInfo);
    }
    agentInfo.step_count++;
    if (step.tokens) agentInfo.total_tokens += step.tokens.total_tokens;
    if (cost) agentInfo.total_cost += cost.total_cost;

    // Update session status
    if (step.status === 'error') {
      session.status = 'failed';
    }

    // Run anomaly detection
    this.detectAnomalies(session, step);

    // Emit events for SSE subscribers
    if (isNewSession) {
      this.emit('session:new', { id: session.id, name: session.name, started_at: session.started_at });
    }
    this.emit('step:new', { session_id: sessionId, step });
    this.emit('session:update', {
      id: session.id,
      total_steps: session.total_steps,
      total_tokens: session.total_tokens,
      total_cost: session.total_cost,
      anomaly_count: session.anomaly_count,
      status: session.status,
    });

    // Persist to disk
    this.schedulePersist();

    return step;
  }

  private detectAnomalies(session: TraceSession, step: TraceStep) {
    // ─── Loop detection (works with AND without payloads) ─────────────
    if (session.steps.length >= 2) {
      const prev = session.steps[session.steps.length - 2];
      if (prev.agent_name === step.agent_name) {
        let similarity = 0;

        // Prefer full-text comparison when payloads are available
        if (step.prompt && prev.prompt) {
          similarity = this.textSimilarity(step.prompt, prev.prompt);
        }
        // Fall back to SimHash fingerprint comparison (works when storePayloads: false)
        else if (step.promptFingerprint != null && prev.promptFingerprint != null) {
          similarity = this.simHashSimilarity(step.promptFingerprint, prev.promptFingerprint);
        }

        if (similarity > 0.85) {
          step.anomalies = step.anomalies || [];
          step.anomalies.push({
            type: 'repeated_prompt',
            severity: 'warning',
            message: `${(similarity * 100).toFixed(0)}% similar to previous prompt`,
            details: 'Possible infinite loop detected',
          });
          session.anomaly_count++;
        }
      }
    }

    // Check for high cost
    if (step.cost && step.cost.total_cost > 0.05) {
      step.anomalies = step.anomalies || [];
      step.anomalies.push({
        type: 'high_cost',
        severity: step.cost.total_cost > 0.20 ? 'critical' : 'warning',
        message: `High cost step: $${step.cost.total_cost.toFixed(4)}`,
      });
      session.anomaly_count++;
    }

    // Check for empty response
    if (step.step_type === 'llm_call' && (!step.response || step.response.trim() === '')) {
      step.anomalies = step.anomalies || [];
      step.anomalies.push({
        type: 'empty_response',
        severity: 'warning',
        message: 'Model returned empty response',
      });
      session.anomaly_count++;
    }
  }

  // ─── Text Similarity (Jaccard, used when payloads are available) ────
  private textSimilarity(a: string, b: string): number {
    const tokensA = new Set(a.toLowerCase().split(/\s+/));
    const tokensB = new Set(b.toLowerCase().split(/\s+/));
    const intersection = [...tokensA].filter(t => tokensB.has(t));
    const union = new Set([...tokensA, ...tokensB]);
    return union.size > 0 ? intersection.length / union.size : 0;
  }

  // ─── SimHash (locality-sensitive hashing for fingerprint comparison) ─
  /** Compute a 32-bit SimHash fingerprint from text.
   *  Similar texts produce hashes with low Hamming distance. */
  private computeSimHash(text: string): number {
    const tokens = text.toLowerCase().split(/\s+/).filter(t => t.length > 0);
    const bits = 32;
    const v = new Array(bits).fill(0);

    for (const token of tokens) {
      const hash = this.fnv1a(token);
      for (let i = 0; i < bits; i++) {
        v[i] += ((hash >>> i) & 1) ? 1 : -1;
      }
    }

    let simhash = 0;
    for (let i = 0; i < bits; i++) {
      if (v[i] > 0) simhash |= (1 << i);
    }
    return simhash >>> 0; // unsigned 32-bit
  }

  /** FNV-1a hash — fast, well-distributed 32-bit hash for individual tokens */
  private fnv1a(str: string): number {
    let hash = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash = (hash * 0x01000193) | 0;
    }
    return hash >>> 0;
  }

  /** Compare two SimHash fingerprints via normalized Hamming distance.
   *  Returns 0.0–1.0 where 1.0 = identical. */
  private simHashSimilarity(a: number, b: number): number {
    let xor = (a ^ b) >>> 0;
    let diffBits = 0;
    while (xor) {
      diffBits += xor & 1;
      xor >>>= 1;
    }
    return 1 - (diffBits / 32);
  }

  endSession(sessionId: string, status?: 'completed' | 'failed') {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.status = status || 'completed';
      session.ended_at = new Date().toISOString();
      this.emit('session:end', { id: sessionId, status: session.status });
      // Flush immediately on session end (important checkpoint)
      this.flushToDisk();
    }
  }

  getSession(sessionId: string): TraceSession | undefined {
    return this.sessions.get(sessionId);
  }

  getAllSessions(): TraceSession[] {
    return Array.from(this.sessions.values()).sort(
      (a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime()
    );
  }

  /** Share a session — generates a share token */
  shareSession(sessionId: string): string | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    const token = Buffer.from(sessionId).toString('base64url');
    return token;
  }

  /** Get session by share token */
  getSharedSession(token: string): TraceSession | undefined {
    const sessionId = Buffer.from(token, 'base64url').toString();
    return this.sessions.get(sessionId);
  }

  clear() {
    this.sessions.clear();
    this.flushToDisk();
  }

  /** Clean up resources — call on server shutdown to prevent timer leaks. */
  destroy() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.listeners.clear();
  }

  /** Remove stale sampled-out session IDs to prevent unbounded memory growth.
   *  Called automatically during cleanup cycles. */
  private pruneSampledOutSessions() {
    // Keep the set bounded: if it exceeds 10K entries, clear it entirely.
    // This means a few previously-dropped sessions might get re-sampled,
    // which is harmless — it only affects the first step of a resumed session.
    if (this.sampledOutSessions.size > 10_000) {
      this.sampledOutSessions.clear();
    }
  }
}

// Singleton instance
export const traceStore = new TraceStore();

