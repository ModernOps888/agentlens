'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { TraceSession, TraceStep, Anomaly } from '@/lib/types';
import { demoSessions } from '@/lib/demo-data';

// ─── Step Type Config ───────────────────────────────────────────────────────
const STEP_TYPE_CONFIG: Record<string, { icon: string; label: string }> = {
  llm_call: { icon: '🧠', label: 'LLM Call' },
  tool_call: { icon: '🔧', label: 'Tool Call' },
  mcp_invoke: { icon: '🔌', label: 'MCP Invoke' },
  agent_spawn: { icon: '🚀', label: 'Agent Spawn' },
  decision: { icon: '🎯', label: 'Decision' },
  error: { icon: '💥', label: 'Error' },
};

// ─── Helper Functions ───────────────────────────────────────────────────────
function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatCost(cost: number): string {
  if (cost === 0) return '$0';
  if (cost < 0.001) return `$${cost.toFixed(5)}`;
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(4)}`;
}

function formatTokens(tokens: number): string {
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`;
  return `${tokens}`;
}

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function getStepPreview(step: TraceStep): string {
  if (step.step_type === 'llm_call') {
    return step.prompt?.substring(0, 120) || step.response?.substring(0, 120) || '';
  }
  if (step.step_type === 'tool_call') {
    return `${step.tool_name}(${JSON.stringify(step.tool_input || {}).substring(0, 80)})`;
  }
  if (step.step_type === 'mcp_invoke' && step.mcp) {
    return `${step.mcp.server_name}.${step.mcp.tool_name}()`;
  }
  if (step.step_type === 'agent_spawn') {
    return `Spawning ${step.spawned_agent}`;
  }
  if (step.step_type === 'decision') {
    return step.decision_reason || '';
  }
  if (step.step_type === 'error') {
    return step.error_message || 'Unknown error';
  }
  return '';
}

// ─── Session Card Component ────────────────────────────────────────────────
function SessionCard({
  session,
  active,
  onClick,
}: {
  session: TraceSession;
  active: boolean;
  onClick: () => void;
}) {
  const statusClass = session.status === 'failed' ? 'failed' : '';
  return (
    <div
      className={`session-card ${active ? 'active' : ''} ${statusClass}`}
      onClick={onClick}
      id={`session-${session.id}`}
    >
      <div className="session-card-name">{session.name}</div>
      <div className="session-card-meta">
        <span className="session-card-stat">
          <span className="value">{session.agents.length}</span> agents
        </span>
        <span className="session-card-stat">
          <span className="value">{session.total_steps}</span> steps
        </span>
        <span className="session-card-stat">
          <span className="value">{formatCost(session.total_cost)}</span>
        </span>
      </div>
      <div className={`session-card-status ${session.status}`}>
        <span className={`status-dot ${session.status === 'running' ? 'pulse' : ''}`} />
        {session.status}
        {session.anomaly_count > 0 && (
          <span style={{ marginLeft: 6 }}>⚠️ {session.anomaly_count}</span>
        )}
      </div>
    </div>
  );
}

// ─── Filter & Search Toolbar ────────────────────────────────────────────────
function FilterToolbar({
  session,
  searchQuery,
  setSearchQuery,
  filterAgent,
  setFilterAgent,
  filterType,
  setFilterType,
  filterStatus,
  setFilterStatus,
  filteredCount,
  totalCount,
}: {
  session: TraceSession;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  filterAgent: string;
  setFilterAgent: (a: string) => void;
  filterType: string;
  setFilterType: (t: string) => void;
  filterStatus: string;
  setFilterStatus: (s: string) => void;
  filteredCount: number;
  totalCount: number;
}) {
  const hasFilters = searchQuery || filterAgent || filterType || filterStatus;

  return (
    <div className="filter-toolbar" id="filter-toolbar">
      <div className="filter-search-wrapper">
        <span className="filter-search-icon">🔍</span>
        <input
          type="text"
          className="filter-search"
          placeholder="Search steps... (prompts, responses, tools)"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          id="search-input"
        />
        {searchQuery && (
          <button className="filter-clear-btn" onClick={() => setSearchQuery('')}>✕</button>
        )}
      </div>
      <div className="filter-selects">
        <select
          className="filter-select"
          value={filterAgent}
          onChange={e => setFilterAgent(e.target.value)}
          id="filter-agent"
        >
          <option value="">All Agents</option>
          {session.agents.map(a => (
            <option key={a.name} value={a.name}>{a.name}</option>
          ))}
        </select>
        <select
          className="filter-select"
          value={filterType}
          onChange={e => setFilterType(e.target.value)}
          id="filter-type"
        >
          <option value="">All Types</option>
          {Object.entries(STEP_TYPE_CONFIG).map(([key, val]) => (
            <option key={key} value={key}>{val.icon} {val.label}</option>
          ))}
        </select>
        <select
          className="filter-select"
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
          id="filter-status"
        >
          <option value="">All Status</option>
          <option value="success">✅ Success</option>
          <option value="error">❌ Error</option>
          <option value="loop_detected">🔄 Loop Detected</option>
        </select>
        {hasFilters && (
          <button
            className="filter-reset-btn"
            onClick={() => {
              setSearchQuery('');
              setFilterAgent('');
              setFilterType('');
              setFilterStatus('');
            }}
          >
            Clear All
          </button>
        )}
      </div>
      {hasFilters && (
        <div className="filter-result-count">
          Showing <strong>{filteredCount}</strong> of {totalCount} steps
        </div>
      )}
    </div>
  );
}

// ─── Timeline Step Component ────────────────────────────────────────────────
function TimelineStep({
  step,
  index,
  active,
  onClick,
  dimmed,
}: {
  step: TraceStep;
  index: number;
  active: boolean;
  onClick: () => void;
  dimmed?: boolean;
}) {
  const config = STEP_TYPE_CONFIG[step.step_type] || { icon: '❓', label: 'Unknown' };
  const hasAnomaly = step.anomalies && step.anomalies.length > 0;
  const isCritical = step.anomalies?.some(a => a.severity === 'critical');

  return (
    <div
      className={`timeline-step ${active ? 'active' : ''} ${hasAnomaly ? 'has-anomaly' : ''} ${isCritical ? 'critical' : ''} ${dimmed ? 'dimmed' : ''}`}
      onClick={onClick}
      style={{
        animationDelay: `${index * 60}ms`,
        ['--agent-color' as string]: step.agent_color,
      }}
      id={`step-${step.id}`}
    >
      <style>{`
        #step-${step.id}::before {
          background: ${step.agent_color};
        }
      `}</style>
      <div className="step-header">
        <div className="step-header-left">
          <span
            className="step-agent-badge"
            style={{
              color: step.agent_color,
              background: `${step.agent_color}15`,
              border: `1px solid ${step.agent_color}30`,
            }}
          >
            <span style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: step.agent_color,
              display: 'inline-block',
            }} />
            {step.agent_name}
          </span>
          <span className="step-type-badge">
            <span className="step-type-icon">{config.icon}</span>
            {config.label}
          </span>
        </div>
        <div className="step-header-right">
          <span className="step-duration">{formatDuration(step.duration_ms)}</span>
          {step.cost && step.cost.total_cost > 0 && (
            <span className="step-cost-badge">{formatCost(step.cost.total_cost)}</span>
          )}
          {step.status === 'error' && <span style={{ fontSize: 12, color: 'var(--accent-red)' }}>✕ Error</span>}
          {step.status === 'loop_detected' && <span style={{ fontSize: 12, color: 'var(--accent-red)' }}>🔄 Loop</span>}
        </div>
      </div>
      <div className="step-preview">{getStepPreview(step)}</div>
      {hasAnomaly && step.anomalies!.map((anomaly, i) => (
        <div key={i} className={`step-anomaly-bar ${anomaly.severity}`}>
          <span>{anomaly.severity === 'critical' ? '🚨' : '⚠️'}</span>
          <span>{anomaly.message}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Inspector Panel Component ──────────────────────────────────────────────
type InspectorTab = 'details' | 'prompt' | 'response' | 'mcp' | 'anomalies';

function InspectorPanel({ step, session }: { step: TraceStep | null; session: TraceSession | null }) {
  const [activeTab, setActiveTab] = useState<InspectorTab>('details');

  if (!step) {
    return (
      <div className="inspector">
        <div className="inspector-header">
          <span className="inspector-title">Inspector</span>
        </div>
        <div className="inspector-empty">
          <div className="inspector-empty-icon">🔍</div>
          <div className="inspector-empty-text">Select a step to inspect</div>
          <div className="inspector-empty-hint">
            Click any step in the timeline to view its full details,
            prompts, responses, and diagnostics
          </div>
        </div>
      </div>
    );
  }

  const tabs: { id: InspectorTab; label: string; show: boolean }[] = [
    { id: 'details', label: 'Details', show: true },
    { id: 'prompt', label: 'Prompt', show: step.step_type === 'llm_call' },
    { id: 'response', label: 'Response', show: step.step_type === 'llm_call' },
    { id: 'mcp', label: 'MCP', show: step.step_type === 'mcp_invoke' },
    { id: 'anomalies', label: `Anomalies (${step.anomalies?.length || 0})`, show: (step.anomalies?.length || 0) > 0 },
  ];

  const visibleTabs = tabs.filter(t => t.show);
  const currentTab = visibleTabs.find(t => t.id === activeTab) ? activeTab : 'details';

  return (
    <div className="inspector">
      <div className="inspector-header">
        <span className="inspector-title">Inspector</span>
        <span
          className="step-agent-badge"
          style={{
            color: step.agent_color,
            background: `${step.agent_color}15`,
            border: `1px solid ${step.agent_color}30`,
          }}
        >
          {step.agent_name}
        </span>
      </div>

      <div className="inspector-tabs">
        {visibleTabs.map(tab => (
          <div
            key={tab.id}
            className={`inspector-tab ${currentTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </div>
        ))}
      </div>

      <div className="inspector-content">
        {currentTab === 'details' && <InspectorDetails step={step} />}
        {currentTab === 'prompt' && <InspectorPrompt step={step} />}
        {currentTab === 'response' && <InspectorResponse step={step} />}
        {currentTab === 'mcp' && <InspectorMCP step={step} />}
        {currentTab === 'anomalies' && <InspectorAnomalies step={step} />}
      </div>
    </div>
  );
}

function InspectorDetails({ step }: { step: TraceStep }) {
  return (
    <>
      <div className="data-section animate-in">
        <div className="data-section-header">
          <span className="data-section-title">Metadata</span>
        </div>
        <div className="data-block">
          <div className="data-kv-row">
            <span className="data-kv-key">Step ID</span>
            <span className="data-kv-value">{step.id}</span>
          </div>
          <div className="data-kv-row">
            <span className="data-kv-key">Type</span>
            <span className="data-kv-value">{STEP_TYPE_CONFIG[step.step_type]?.label || step.step_type}</span>
          </div>
          <div className="data-kv-row">
            <span className="data-kv-key">Status</span>
            <span className={`data-kv-value ${step.status === 'error' || step.status === 'loop_detected' ? 'error' : ''}`}>
              {step.status}
            </span>
          </div>
          {step.provider && (
            <div className="data-kv-row">
              <span className="data-kv-key">Provider</span>
              <span className="data-kv-value provider">{step.provider}</span>
            </div>
          )}
          {step.model && (
            <div className="data-kv-row">
              <span className="data-kv-key">Model</span>
              <span className="data-kv-value model">{step.model}</span>
            </div>
          )}
          {step.temperature !== undefined && (
            <div className="data-kv-row">
              <span className="data-kv-key">Temperature</span>
              <span className="data-kv-value">{step.temperature}</span>
            </div>
          )}
          <div className="data-kv-row">
            <span className="data-kv-key">Duration</span>
            <span className="data-kv-value">{formatDuration(step.duration_ms)}</span>
          </div>
          <div className="data-kv-row">
            <span className="data-kv-key">Timestamp</span>
            <span className="data-kv-value">{new Date(step.timestamp).toLocaleTimeString()}</span>
          </div>
          {step.spawned_agent && (
            <div className="data-kv-row">
              <span className="data-kv-key">Spawned</span>
              <span className="data-kv-value" style={{ color: 'var(--accent-amber)' }}>{step.spawned_agent}</span>
            </div>
          )}
          {step.decision_reason && (
            <div className="data-kv-row">
              <span className="data-kv-key">Reason</span>
              <span className="data-kv-value">{step.decision_reason}</span>
            </div>
          )}
          {step.error_message && (
            <div className="data-kv-row">
              <span className="data-kv-key">Error</span>
              <span className="data-kv-value error">{step.error_message}</span>
            </div>
          )}
        </div>
      </div>

      {step.tokens && (
        <div className="data-section animate-in" style={{ animationDelay: '100ms' }}>
          <div className="data-section-header">
            <span className="data-section-title">Token Usage</span>
            <span className="data-section-badge">{formatTokens(step.tokens.total_tokens)} total</span>
          </div>
          <div className="data-block">
            <div className="data-kv-row">
              <span className="data-kv-key">Prompt</span>
              <span className="data-kv-value">{step.tokens.prompt_tokens.toLocaleString()}</span>
            </div>
            <div className="data-kv-row">
              <span className="data-kv-key">Completion</span>
              <span className="data-kv-value">{step.tokens.completion_tokens.toLocaleString()}</span>
            </div>
            <div className="data-kv-row">
              <span className="data-kv-key">Total</span>
              <span className="data-kv-value">{step.tokens.total_tokens.toLocaleString()}</span>
            </div>
          </div>
          <div style={{ padding: '0 4px' }}>
            <div className="token-bar">
              <div
                className="token-bar-segment input"
                style={{ width: `${(step.tokens.prompt_tokens / step.tokens.total_tokens) * 100}%` }}
              />
              <div
                className="token-bar-segment output"
                style={{ width: `${(step.tokens.completion_tokens / step.tokens.total_tokens) * 100}%` }}
              />
            </div>
            <div className="token-bar-labels">
              <span className="token-bar-label">
                <span className="token-bar-label-dot" style={{ background: 'var(--accent-cyan)' }} />
                Input ({Math.round((step.tokens.prompt_tokens / step.tokens.total_tokens) * 100)}%)
              </span>
              <span className="token-bar-label">
                <span className="token-bar-label-dot" style={{ background: 'var(--accent-purple)' }} />
                Output ({Math.round((step.tokens.completion_tokens / step.tokens.total_tokens) * 100)}%)
              </span>
            </div>
          </div>
        </div>
      )}

      {step.cost && step.cost.total_cost > 0 && (
        <div className="data-section animate-in" style={{ animationDelay: '200ms' }}>
          <div className="data-section-header">
            <span className="data-section-title">Cost Breakdown</span>
          </div>
          <div className="data-block">
            <div className="data-kv-row">
              <span className="data-kv-key">Input Cost</span>
              <span className="data-kv-value cost">{formatCost(step.cost.input_cost)}</span>
            </div>
            <div className="data-kv-row">
              <span className="data-kv-key">Output Cost</span>
              <span className="data-kv-value cost">{formatCost(step.cost.output_cost)}</span>
            </div>
            <div className="data-kv-row">
              <span className="data-kv-key">Total</span>
              <span className="data-kv-value cost" style={{ fontSize: 14, fontWeight: 700 }}>
                {formatCost(step.cost.total_cost)}
              </span>
            </div>
          </div>
        </div>
      )}

      {step.tool_name && (
        <div className="data-section animate-in" style={{ animationDelay: '150ms' }}>
          <div className="data-section-header">
            <span className="data-section-title">Tool Call</span>
          </div>
          <div className="data-block">
            <div className="data-kv-row">
              <span className="data-kv-key">Tool</span>
              <span className="data-kv-value model">{step.tool_name}</span>
            </div>
            <div className="data-kv-row">
              <span className="data-kv-key">Input</span>
              <span className="data-kv-value" style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                {JSON.stringify(step.tool_input, null, 2)}
              </span>
            </div>
            <div className="data-kv-row">
              <span className="data-kv-key">Output</span>
              <span className="data-kv-value" style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                {JSON.stringify(step.tool_output, null, 2)}
              </span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function InspectorPrompt({ step }: { step: TraceStep }) {
  return (
    <>
      {step.system_prompt && (
        <div className="data-section animate-in">
          <div className="data-section-header">
            <span className="data-section-title">System Prompt</span>
          </div>
          <div className="data-block">
            <div className="data-block-content" style={{ color: 'var(--accent-amber)', opacity: 0.9 }}>
              {step.system_prompt}
            </div>
          </div>
        </div>
      )}
      <div className="data-section animate-in" style={{ animationDelay: '100ms' }}>
        <div className="data-section-header">
          <span className="data-section-title">User Prompt</span>
          {step.tokens && (
            <span className="data-section-badge">{step.tokens.prompt_tokens.toLocaleString()} tokens</span>
          )}
        </div>
        <div className="data-block">
          <div className="data-block-content">{step.prompt || 'No prompt data'}</div>
        </div>
      </div>
    </>
  );
}

function InspectorResponse({ step }: { step: TraceStep }) {
  return (
    <div className="data-section animate-in">
      <div className="data-section-header">
        <span className="data-section-title">Model Response</span>
        {step.tokens && (
          <span className="data-section-badge">{step.tokens.completion_tokens.toLocaleString()} tokens</span>
        )}
      </div>
      <div className="data-block">
        <div className="data-block-content" style={{ maxHeight: 500 }}>
          {step.response || 'No response data'}
        </div>
      </div>
    </div>
  );
}

function InspectorMCP({ step }: { step: TraceStep }) {
  if (!step.mcp) return null;
  const mcp = step.mcp;

  return (
    <>
      <div className="data-section animate-in">
        <div className="mcp-card">
          <div className="mcp-card-header">
            <span>🔌</span>
            <span className="mcp-server-name">{mcp.server_name}</span>
            <span className="mcp-separator">→</span>
            <span className="mcp-tool-name">{mcp.tool_name}</span>
            <span className={`mcp-valid-badge ${mcp.valid ? 'valid' : 'invalid'}`}>
              {mcp.valid ? '✓ Valid' : '✕ Invalid'}
            </span>
          </div>
          <div className="data-kv-row">
            <span className="data-kv-key">Duration</span>
            <span className="data-kv-value">{formatDuration(mcp.duration_ms)}</span>
          </div>
        </div>
      </div>

      <div className="data-section animate-in" style={{ animationDelay: '100ms' }}>
        <div className="data-section-header">
          <span className="data-section-title">Parameters</span>
        </div>
        <div className="data-block">
          <div className="data-block-content" style={{ color: 'var(--accent-cyan)' }}>
            {JSON.stringify(mcp.params, null, 2)}
          </div>
        </div>
      </div>

      <div className="data-section animate-in" style={{ animationDelay: '200ms' }}>
        <div className="data-section-header">
          <span className="data-section-title">Result</span>
        </div>
        <div className="data-block">
          <div className="data-block-content">
            {JSON.stringify(mcp.result, null, 2)}
          </div>
        </div>
      </div>

      {mcp.schema && (
        <div className="data-section animate-in" style={{ animationDelay: '300ms' }}>
          <div className="data-section-header">
            <span className="data-section-title">Schema</span>
          </div>
          <div className="data-block">
            <div className="data-block-content" style={{ color: 'var(--text-tertiary)' }}>
              {JSON.stringify(mcp.schema, null, 2)}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function InspectorAnomalies({ step }: { step: TraceStep }) {
  if (!step.anomalies || step.anomalies.length === 0) return null;
  return (
    <div className="data-section animate-in">
      <div className="data-section-header">
        <span className="data-section-title">Detected Anomalies</span>
        <span className="data-section-badge" style={{ color: 'var(--accent-red)', background: 'rgba(239,68,68,0.1)' }}>
          {step.anomalies.length} found
        </span>
      </div>
      {step.anomalies.map((anomaly, i) => (
        <div key={i} className={`anomaly-card ${anomaly.severity}`} style={{ animationDelay: `${i * 100}ms` }}>
          <div className="anomaly-card-header">
            <span>{anomaly.severity === 'critical' ? '🚨' : '⚠️'}</span>
            <span>{anomaly.type.replace(/_/g, ' ').toUpperCase()}</span>
          </div>
          <div>{anomaly.message}</div>
          {anomaly.details && (
            <div className="anomaly-card-details" style={{ marginTop: 6 }}>{anomaly.details}</div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Cost Dashboard Tab ─────────────────────────────────────────────────────
function CostDashboard({ session }: { session: TraceSession }) {
  const maxCost = Math.max(...session.agents.map(a => a.total_cost));

  return (
    <div className="inspector-content">
      <div className="cost-grid animate-in">
        <div className="cost-card">
          <div className="cost-card-value" style={{ color: 'var(--accent-emerald)' }}>
            {formatCost(session.total_cost)}
          </div>
          <div className="cost-card-label">Total Cost</div>
        </div>
        <div className="cost-card">
          <div className="cost-card-value" style={{ color: 'var(--accent-cyan)' }}>
            {formatTokens(session.total_tokens)}
          </div>
          <div className="cost-card-label">Total Tokens</div>
        </div>
        <div className="cost-card">
          <div className="cost-card-value" style={{ color: 'var(--accent-purple)' }}>
            {session.total_steps}
          </div>
          <div className="cost-card-label">Total Steps</div>
        </div>
        <div className="cost-card">
          <div className="cost-card-value" style={{ color: 'var(--accent-amber)' }}>
            {formatDuration(session.total_duration_ms)}
          </div>
          <div className="cost-card-label">Duration</div>
        </div>
      </div>

      <div className="data-section animate-in" style={{ animationDelay: '100ms' }}>
        <div className="data-section-header">
          <span className="data-section-title">Cost by Agent</span>
        </div>
        {session.agents.map((agent, i) => (
          <div key={agent.name} className="cost-agent-row">
            <span className="cost-agent-name" style={{ color: agent.color }}>
              <span style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: agent.color,
                display: 'inline-block',
                marginRight: 8,
              }} />
              {agent.name}
            </span>
            <div className="cost-agent-bar-container">
              <div
                className="cost-agent-bar"
                style={{
                  width: maxCost > 0 ? `${(agent.total_cost / maxCost) * 100}%` : '0%',
                  background: agent.color,
                }}
              />
            </div>
            <span className="cost-agent-value" style={{ color: agent.color }}>
              {formatCost(agent.total_cost)}
            </span>
          </div>
        ))}
      </div>

      <div className="data-section animate-in" style={{ animationDelay: '200ms' }}>
        <div className="data-section-header">
          <span className="data-section-title">Token Distribution</span>
        </div>
        {session.agents.map((agent) => (
          <div key={agent.name} className="cost-agent-row">
            <span className="cost-agent-name" style={{ color: agent.color }}>
              <span style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: agent.color,
                display: 'inline-block',
                marginRight: 8,
              }} />
              {agent.name}
            </span>
            <div className="cost-agent-bar-container">
              <div
                className="cost-agent-bar"
                style={{
                  width: session.total_tokens > 0 ? `${(agent.total_tokens / session.total_tokens) * 100}%` : '0%',
                  background: agent.color,
                  opacity: 0.7,
                }}
              />
            </div>
            <span className="cost-agent-value" style={{ color: 'var(--text-secondary)' }}>
              {formatTokens(agent.total_tokens)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Budget Alerts Panel ────────────────────────────────────────────────────
function BudgetAlerts({
  session,
  budgetLimit,
  setBudgetLimit,
  tokenLimit,
  setTokenLimit,
}: {
  session: TraceSession;
  budgetLimit: number;
  setBudgetLimit: (v: number) => void;
  tokenLimit: number;
  setTokenLimit: (v: number) => void;
}) {
  const costPercent = budgetLimit > 0 ? (session.total_cost / budgetLimit) * 100 : 0;
  const tokenPercent = tokenLimit > 0 ? (session.total_tokens / tokenLimit) * 100 : 0;
  const costStatus = costPercent >= 100 ? 'critical' : costPercent >= 80 ? 'warning' : 'ok';
  const tokenStatus = tokenPercent >= 100 ? 'critical' : tokenPercent >= 80 ? 'warning' : 'ok';

  // Per-agent budget analysis
  const hotAgent = session.agents.length > 0
    ? session.agents.reduce((max, a) => a.total_cost > max.total_cost ? a : max, session.agents[0])
    : null;
  const hotAgentPercent = budgetLimit > 0 && hotAgent ? (hotAgent.total_cost / budgetLimit) * 100 : 0;

  // Anomaly cost projection
  const avgCostPerStep = session.total_steps > 0 ? session.total_cost / session.total_steps : 0;
  const projectedCost50 = avgCostPerStep * 50;
  const projectedCost100 = avgCostPerStep * 100;

  return (
    <div className="inspector-content">
      {/* Budget Gauges */}
      <div className="budget-gauges animate-in">
        <div className={`budget-gauge ${costStatus}`}>
          <div className="budget-gauge-header">
            <span className="budget-gauge-label">💰 Cost Budget</span>
            <span className={`budget-gauge-status ${costStatus}`}>
              {costStatus === 'critical' ? '🚨 EXCEEDED' : costStatus === 'warning' ? '⚠️ WARNING' : '✅ OK'}
            </span>
          </div>
          <div className="budget-gauge-bar-container">
            <div
              className={`budget-gauge-bar ${costStatus}`}
              style={{ width: `${Math.min(costPercent, 100)}%` }}
            />
            {costPercent > 100 && (
              <div className="budget-gauge-overflow" style={{ width: `${Math.min(costPercent - 100, 100)}%` }} />
            )}
          </div>
          <div className="budget-gauge-values">
            <span>{formatCost(session.total_cost)}</span>
            <span>/ {formatCost(budgetLimit)}</span>
          </div>
          <div className="budget-input-row">
            <label>Limit: $</label>
            <input
              type="number"
              className="budget-input"
              value={budgetLimit}
              step={0.01}
              min={0}
              onChange={e => setBudgetLimit(parseFloat(e.target.value) || 0)}
            />
          </div>
        </div>

        <div className={`budget-gauge ${tokenStatus}`}>
          <div className="budget-gauge-header">
            <span className="budget-gauge-label">🧠 Token Budget</span>
            <span className={`budget-gauge-status ${tokenStatus}`}>
              {tokenStatus === 'critical' ? '🚨 EXCEEDED' : tokenStatus === 'warning' ? '⚠️ WARNING' : '✅ OK'}
            </span>
          </div>
          <div className="budget-gauge-bar-container">
            <div
              className={`budget-gauge-bar ${tokenStatus}`}
              style={{ width: `${Math.min(tokenPercent, 100)}%` }}
            />
          </div>
          <div className="budget-gauge-values">
            <span>{formatTokens(session.total_tokens)}</span>
            <span>/ {formatTokens(tokenLimit)}</span>
          </div>
          <div className="budget-input-row">
            <label>Limit:</label>
            <input
              type="number"
              className="budget-input"
              value={tokenLimit}
              step={1000}
              min={0}
              onChange={e => setTokenLimit(parseInt(e.target.value) || 0)}
            />
          </div>
        </div>
      </div>

      {/* Alerts Log */}
      <div className="data-section animate-in" style={{ animationDelay: '200ms' }}>
        <div className="data-section-header">
          <span className="data-section-title">Active Alerts</span>
          <span className="data-section-badge" style={{
            color: (costStatus !== 'ok' || tokenStatus !== 'ok') ? 'var(--accent-red)' : 'var(--accent-emerald)',
            background: (costStatus !== 'ok' || tokenStatus !== 'ok') ? 'rgba(239,68,68,0.1)' : 'rgba(16,185,129,0.1)',
          }}>
            {costStatus !== 'ok' || tokenStatus !== 'ok' ? 'Action Required' : 'All Clear'}
          </span>
        </div>
        <div className="budget-alerts-list">
          {costStatus === 'critical' && (
            <div className="budget-alert critical">
              <span className="budget-alert-icon">🚨</span>
              <div>
                <div className="budget-alert-title">Cost budget exceeded!</div>
                <div className="budget-alert-desc">
                  Session cost ({formatCost(session.total_cost)}) has exceeded the budget of {formatCost(budgetLimit)}.
                  {hotAgent && (
                    <> Agent <strong style={{ color: hotAgent.color }}>{hotAgent.name}</strong> is the highest spender ({formatCost(hotAgent.total_cost)}, {hotAgentPercent.toFixed(0)}% of budget).</>
                  )}
                </div>
              </div>
            </div>
          )}
          {costStatus === 'warning' && (
            <div className="budget-alert warning">
              <span className="budget-alert-icon">⚠️</span>
              <div>
                <div className="budget-alert-title">Approaching cost limit</div>
                <div className="budget-alert-desc">
                  Session is at {costPercent.toFixed(0)}% of the {formatCost(budgetLimit)} budget.
                  {avgCostPerStep > 0 && ` At current rate, ${Math.ceil((budgetLimit - session.total_cost) / avgCostPerStep)} more steps before limit.`}
                </div>
              </div>
            </div>
          )}
          {tokenStatus === 'critical' && (
            <div className="budget-alert critical">
              <span className="budget-alert-icon">🚨</span>
              <div>
                <div className="budget-alert-title">Token budget exceeded!</div>
                <div className="budget-alert-desc">
                  Used {formatTokens(session.total_tokens)} tokens vs limit of {formatTokens(tokenLimit)}.
                  Agent halting recommended.
                </div>
              </div>
            </div>
          )}
          {tokenStatus === 'warning' && (
            <div className="budget-alert warning">
              <span className="budget-alert-icon">⚠️</span>
              <div>
                <div className="budget-alert-title">Approaching token limit</div>
                <div className="budget-alert-desc">
                  Token usage at {tokenPercent.toFixed(0)}% of budget ({formatTokens(session.total_tokens)} / {formatTokens(tokenLimit)}).
                </div>
              </div>
            </div>
          )}
          {session.anomaly_count > 0 && (
            <div className="budget-alert warning">
              <span className="budget-alert-icon">🔄</span>
              <div>
                <div className="budget-alert-title">Anomalies detected</div>
                <div className="budget-alert-desc">
                  {session.anomaly_count} anomalies in this session. Review timeline for details.
                </div>
              </div>
            </div>
          )}
          {costStatus === 'ok' && tokenStatus === 'ok' && session.anomaly_count === 0 && (
            <div className="budget-alert ok">
              <span className="budget-alert-icon">✅</span>
              <div>
                <div className="budget-alert-title">All systems normal</div>
                <div className="budget-alert-desc">
                  Cost and token usage within budgets. No anomalies detected.
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Cost Projection */}
      <div className="data-section animate-in" style={{ animationDelay: '300ms' }}>
        <div className="data-section-header">
          <span className="data-section-title">Cost Projection</span>
        </div>
        <div className="data-block">
          <div className="data-kv-row">
            <span className="data-kv-key">Avg/Step</span>
            <span className="data-kv-value cost">{formatCost(avgCostPerStep)}</span>
          </div>
          <div className="data-kv-row">
            <span className="data-kv-key">@ 50 steps</span>
            <span className="data-kv-value" style={{ color: projectedCost50 > budgetLimit && budgetLimit > 0 ? 'var(--accent-red)' : 'var(--text-secondary)' }}>
              {formatCost(projectedCost50)}
              {projectedCost50 > budgetLimit && budgetLimit > 0 && ' ⚠️ over budget'}
            </span>
          </div>
          <div className="data-kv-row">
            <span className="data-kv-key">@ 100 steps</span>
            <span className="data-kv-value" style={{ color: projectedCost100 > budgetLimit && budgetLimit > 0 ? 'var(--accent-red)' : 'var(--text-secondary)' }}>
              {formatCost(projectedCost100)}
              {projectedCost100 > budgetLimit && budgetLimit > 0 && ' 🚨 over budget'}
            </span>
          </div>
          <div className="data-kv-row">
            <span className="data-kv-key">Top Spender</span>
            <span className="data-kv-value" style={{ color: hotAgent?.color || 'var(--text-secondary)' }}>
              {hotAgent ? `${hotAgent.name} (${formatCost(hotAgent.total_cost)})` : '—'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Compare View Component ─────────────────────────────────────────────────
function CompareView({
  sessions,
  onClose,
}: {
  sessions: TraceSession[];
  onClose: () => void;
}) {
  const [leftId, setLeftId] = useState<string>(sessions[0]?.id || '');
  const [rightId, setRightId] = useState<string>(sessions[1]?.id || sessions[0]?.id || '');

  const left = sessions.find(s => s.id === leftId);
  const right = sessions.find(s => s.id === rightId);

  if (!left || !right) return null;

  const metrics = [
    { label: 'Status', left: left.status, right: right.status, icon: '🔘' },
    { label: 'Agents', left: left.agents.length, right: right.agents.length, icon: '👥' },
    { label: 'Steps', left: left.total_steps, right: right.total_steps, icon: '📊' },
    { label: 'Tokens', left: formatTokens(left.total_tokens), right: formatTokens(right.total_tokens), icon: '🧠' },
    { label: 'Cost', left: formatCost(left.total_cost), right: formatCost(right.total_cost), icon: '💰' },
    { label: 'Duration', left: formatDuration(left.total_duration_ms), right: formatDuration(right.total_duration_ms), icon: '⏱️' },
    { label: 'Anomalies', left: left.anomaly_count, right: right.anomaly_count, icon: '⚠️' },
  ];

  // Create aligned step pairs (by index)
  const maxSteps = Math.max(left.steps.length, right.steps.length);

  return (
    <div className="compare-overlay" id="compare-view">
      <div className="compare-header">
        <div className="compare-title">
          <span>🔀</span> Run Comparison
        </div>
        <button className="compare-close" onClick={onClose}>✕ Close</button>
      </div>

      <div className="compare-selectors">
        <div className="compare-selector">
          <label>Run A</label>
          <select value={leftId} onChange={e => setLeftId(e.target.value)} className="filter-select">
            {sessions.map(s => (
              <option key={s.id} value={s.id}>{s.name} ({s.status})</option>
            ))}
          </select>
        </div>
        <div className="compare-vs">VS</div>
        <div className="compare-selector">
          <label>Run B</label>
          <select value={rightId} onChange={e => setRightId(e.target.value)} className="filter-select">
            {sessions.map(s => (
              <option key={s.id} value={s.id}>{s.name} ({s.status})</option>
            ))}
          </select>
        </div>
      </div>

      {/* Metrics comparison */}
      <div className="compare-metrics">
        {metrics.map(m => {
          const isDiff = String(m.left) !== String(m.right);
          return (
            <div key={m.label} className={`compare-metric ${isDiff ? 'diff' : ''}`}>
              <div className="compare-metric-icon">{m.icon}</div>
              <div className="compare-metric-label">{m.label}</div>
              <div className={`compare-metric-value left ${left.status === 'completed' ? 'success' : 'fail'}`}>{String(m.left)}</div>
              <div className={`compare-metric-value right ${right.status === 'completed' ? 'success' : 'fail'}`}>{String(m.right)}</div>
            </div>
          );
        })}
      </div>

      {/* Step-by-step comparison */}
      <div className="compare-steps-header">
        <div className="compare-steps-col-title">{left.name}</div>
        <div className="compare-steps-col-title">{right.name}</div>
      </div>
      <div className="compare-steps-body">
        {Array.from({ length: maxSteps }, (_, i) => {
          const ls = left.steps[i];
          const rs = right.steps[i];
          const configL = ls ? STEP_TYPE_CONFIG[ls.step_type] || { icon: '❓', label: 'Unknown' } : null;
          const configR = rs ? STEP_TYPE_CONFIG[rs.step_type] || { icon: '❓', label: 'Unknown' } : null;
          const isDiff = ls && rs && (ls.step_type !== rs.step_type || ls.status !== rs.status);

          return (
            <div key={i} className={`compare-step-row ${isDiff ? 'diff' : ''}`}>
              <div className="compare-step-cell">
                {ls ? (
                  <>
                    <span className="compare-step-num">{i + 1}</span>
                    <span className="step-agent-badge" style={{
                      color: ls.agent_color, background: `${ls.agent_color}15`,
                      border: `1px solid ${ls.agent_color}30`, fontSize: 10
                    }}>
                      {ls.agent_name}
                    </span>
                    <span className="compare-step-type">{configL?.icon} {configL?.label}</span>
                    <span className="compare-step-duration">{formatDuration(ls.duration_ms)}</span>
                    {ls.cost && ls.cost.total_cost > 0 && (
                      <span className="step-cost-badge" style={{ fontSize: 10 }}>{formatCost(ls.cost.total_cost)}</span>
                    )}
                    {ls.status === 'error' && <span className="compare-step-error">✕</span>}
                    {ls.anomalies && ls.anomalies.length > 0 && <span className="compare-step-anomaly">⚠️ {ls.anomalies.length}</span>}
                  </>
                ) : <span className="compare-step-empty">—</span>}
              </div>
              <div className="compare-step-cell">
                {rs ? (
                  <>
                    <span className="compare-step-num">{i + 1}</span>
                    <span className="step-agent-badge" style={{
                      color: rs.agent_color, background: `${rs.agent_color}15`,
                      border: `1px solid ${rs.agent_color}30`, fontSize: 10
                    }}>
                      {rs.agent_name}
                    </span>
                    <span className="compare-step-type">{configR?.icon} {configR?.label}</span>
                    <span className="compare-step-duration">{formatDuration(rs.duration_ms)}</span>
                    {rs.cost && rs.cost.total_cost > 0 && (
                      <span className="step-cost-badge" style={{ fontSize: 10 }}>{formatCost(rs.cost.total_cost)}</span>
                    )}
                    {rs.status === 'error' && <span className="compare-step-error">✕</span>}
                    {rs.anomalies && rs.anomalies.length > 0 && <span className="compare-step-anomaly">⚠️ {rs.anomalies.length}</span>}
                  </>
                ) : <span className="compare-step-empty">—</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Keyboard Shortcuts Modal ───────────────────────────────────────────────
function KeyboardShortcuts({ onClose }: { onClose: () => void }) {
  const shortcuts = [
    { keys: ['Space'], desc: 'Play / Pause' },
    { keys: ['→'], desc: 'Next step' },
    { keys: ['←'], desc: 'Previous step' },
    { keys: ['R'], desc: 'Reset playback' },
    { keys: ['1-9'], desc: 'Jump to step N' },
    { keys: ['F'], desc: 'Focus search' },
    { keys: ['E'], desc: 'Export trace JSON' },
    { keys: ['C'], desc: 'Toggle cost dashboard' },
    { keys: ['B'], desc: 'Toggle budget alerts' },
    { keys: ['D'], desc: 'Toggle compare/diff view' },
    { keys: ['?'], desc: 'Show keyboard shortcuts' },
    { keys: ['Esc'], desc: 'Close panel / modal' },
  ];

  return (
    <div className="shortcuts-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="shortcuts-modal">
        <div className="shortcuts-modal-header">
          <span>⌨️ Keyboard Shortcuts</span>
          <button className="shortcuts-close" onClick={onClose}>✕</button>
        </div>
        <div className="shortcuts-list">
          {shortcuts.map(s => (
            <div key={s.desc} className="shortcut-row">
              <div className="shortcut-keys">
                {s.keys.map(k => <kbd key={k}>{k}</kbd>)}
              </div>
              <div className="shortcut-desc">{s.desc}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Main App ───────────────────────────────────────────────────────────────
export default function AgentLensApp() {
  const [sessions, setSessions] = useState<TraceSession[]>(demoSessions);
  const [hasLiveSessions, setHasLiveSessions] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [activeStepId, setActiveStepId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackIndex, setPlaybackIndex] = useState(0);
  const [rightPanel, setRightPanel] = useState<'inspector' | 'cost' | 'budget'>('inspector');
  const [showCompare, setShowCompare] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [budgetLimit, setBudgetLimit] = useState(0.10);
  const [tokenLimit, setTokenLimit] = useState(10000);
  const [isLiveStreaming, setIsLiveStreaming] = useState(false);
  const [liveStreamIndex, setLiveStreamIndex] = useState(0);
  const playIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const liveStreamRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  // Fetch live sessions on mount and subscribe to SSE stream
  useEffect(() => {
    const refreshSessions = async () => {
      try {
        const resp = await fetch('/api/sessions');
        if (!resp.ok) return;
        const all = await resp.json() as TraceSession[];
        if (Array.isArray(all) && all.length > 0) {
          setSessions(all);
          const demoIds = new Set(demoSessions.map(d => d.id));
          setHasLiveSessions(all.some(s => !demoIds.has(s.id)));
        }
      } catch {
        // Offline or dev reload
      }
    };

    refreshSessions();

    let es: EventSource | null = null;
    try {
      es = new EventSource('/api/stream');
      es.addEventListener('session:new', () => { refreshSessions(); });
      es.addEventListener('step:new', () => { refreshSessions(); });
      es.addEventListener('session:update', () => { refreshSessions(); });
      es.addEventListener('session:end', () => { refreshSessions(); });
    } catch {
      // Ignore SSE errors when offline
    }

    return () => {
      es?.close();
    };
  }, []);

  // Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [filterAgent, setFilterAgent] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  const activeSession = sessions.find(s => s.id === activeSessionId) || null;
  const activeStep = activeSession?.steps.find(s => s.id === activeStepId) || null;

  // Filter logic
  const filteredSteps = useMemo(() => {
    if (!activeSession) return [];
    return activeSession.steps.filter(step => {
      if (filterAgent && step.agent_name !== filterAgent) return false;
      if (filterType && step.step_type !== filterType) return false;
      if (filterStatus && step.status !== filterStatus) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const haystack = [
          step.prompt, step.response, step.tool_name,
          step.agent_name, step.error_message, step.decision_reason,
          step.spawned_agent, step.mcp?.tool_name, step.mcp?.server_name,
          getStepPreview(step),
        ].filter(Boolean).join(' ').toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [activeSession, searchQuery, filterAgent, filterType, filterStatus]);

  const filteredStepIds = useMemo(() => new Set(filteredSteps.map(s => s.id)), [filteredSteps]);
  const hasActiveFilters = !!(searchQuery || filterAgent || filterType || filterStatus);

  // Auto-select first session
  useEffect(() => {
    if (sessions.length > 0 && !activeSessionId) {
      setActiveSessionId(sessions[0].id);
    }
  }, [sessions, activeSessionId]);

  // Playback logic
  const stopPlayback = useCallback(() => {
    if (playIntervalRef.current) {
      clearInterval(playIntervalRef.current);
      playIntervalRef.current = null;
    }
    setIsPlaying(false);
  }, []);

  const startPlayback = useCallback(() => {
    if (!activeSession) return;
    setIsPlaying(true);
    let idx = playbackIndex;

    playIntervalRef.current = setInterval(() => {
      if (idx >= activeSession.steps.length - 1) {
        stopPlayback();
        return;
      }
      idx++;
      setPlaybackIndex(idx);
      setActiveStepId(activeSession.steps[idx].id);
    }, 1200);
  }, [activeSession, playbackIndex, stopPlayback]);

  const togglePlayback = useCallback(() => {
    if (isPlaying) {
      stopPlayback();
    } else {
      startPlayback();
    }
  }, [isPlaying, startPlayback, stopPlayback]);

  // Reset on session change
  useEffect(() => {
    stopPlayback();
    setActiveStepId(null);
    setPlaybackIndex(0);
    setSearchQuery('');
    setFilterAgent('');
    setFilterType('');
    setFilterStatus('');
  }, [activeSessionId, stopPlayback]);

  // Export functions
  const downloadBlob = useCallback((content: string, filename: string, mimeType: string) => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const exportTraceJSON = useCallback(() => {
    if (!activeSession) return;
    const data = {
      version: '1.3.0',
      exported_at: new Date().toISOString(),
      tool: 'AgentLens',
      session: {
        id: activeSession.id,
        name: activeSession.name,
        status: activeSession.status,
        total_steps: activeSession.total_steps,
        total_tokens: activeSession.total_tokens,
        total_cost: activeSession.total_cost,
        total_duration_ms: activeSession.total_duration_ms,
        anomaly_count: activeSession.anomaly_count,
        agents: activeSession.agents,
        steps: activeSession.steps,
      },
    };
    downloadBlob(JSON.stringify(data, null, 2), `agentlens-trace-${activeSession.id}.json`, 'application/json');
    setShowExportMenu(false);
  }, [activeSession, downloadBlob]);

  const exportTraceOTel = useCallback(() => {
    if (!activeSession) return;
    // OpenTelemetry-compatible trace format
    const otelTrace = {
      resourceSpans: [{
        resource: {
          attributes: [
            { key: 'service.name', value: { stringValue: 'agentlens' } },
            { key: 'service.version', value: { stringValue: '1.3.0' } },
            { key: 'agentlens.session.id', value: { stringValue: activeSession.id } },
            { key: 'agentlens.session.name', value: { stringValue: activeSession.name } },
          ],
        },
        scopeSpans: [{
          scope: { name: 'agentlens.tracer', version: '1.3.0' },
          spans: activeSession.steps.map((step, i) => ({
            traceId: activeSession.id.replace(/-/g, '').padEnd(32, '0'),
            spanId: step.id.replace(/-/g, '').substring(0, 16),
            parentSpanId: i > 0 ? activeSession.steps[i - 1].id.replace(/-/g, '').substring(0, 16) : undefined,
            name: `${step.agent_name}.${step.step_type}`,
            kind: step.step_type === 'llm_call' ? 3 : 1,
            startTimeUnixNano: new Date(step.timestamp).getTime() * 1e6,
            endTimeUnixNano: (new Date(step.timestamp).getTime() + step.duration_ms) * 1e6,
            status: { code: step.status === 'error' ? 2 : 1 },
            attributes: [
              { key: 'agent.name', value: { stringValue: step.agent_name } },
              { key: 'step.type', value: { stringValue: step.step_type } },
              { key: 'step.status', value: { stringValue: step.status } },
              { key: 'duration_ms', value: { intValue: step.duration_ms } },
              ...(step.model ? [{ key: 'llm.model', value: { stringValue: step.model } }] : []),
              ...(step.provider ? [{ key: 'llm.provider', value: { stringValue: step.provider } }] : []),
              ...(step.tokens ? [
                { key: 'llm.token_count.prompt', value: { intValue: step.tokens.prompt_tokens } },
                { key: 'llm.token_count.completion', value: { intValue: step.tokens.completion_tokens } },
              ] : []),
              ...(step.cost ? [{ key: 'llm.cost', value: { doubleValue: step.cost.total_cost } }] : []),
              ...(step.tool_name ? [{ key: 'tool.name', value: { stringValue: step.tool_name } }] : []),
            ],
          })),
        }],
      }],
    };
    downloadBlob(JSON.stringify(otelTrace, null, 2), `agentlens-otel-${activeSession.id}.json`, 'application/json');
    setShowExportMenu(false);
  }, [activeSession, downloadBlob]);

  // Live streaming simulation
  const startLiveStream = useCallback(() => {
    if (!activeSession) return;
    setIsLiveStreaming(true);
    setLiveStreamIndex(0);
    setActiveStepId(null);
    let idx = 0;

    liveStreamRef.current = setInterval(() => {
      if (idx >= activeSession.steps.length) {
        if (liveStreamRef.current) clearInterval(liveStreamRef.current);
        setIsLiveStreaming(false);
        return;
      }
      setLiveStreamIndex(idx + 1);
      setActiveStepId(activeSession.steps[idx].id);
      setPlaybackIndex(idx);
      idx++;
    }, 800 + Math.random() * 600);
  }, [activeSession]);

  const stopLiveStream = useCallback(() => {
    if (liveStreamRef.current) {
      clearInterval(liveStreamRef.current);
      liveStreamRef.current = null;
    }
    setIsLiveStreaming(false);
    if (activeSession) setLiveStreamIndex(activeSession.steps.length);
  }, [activeSession]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ignore if typing in input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) {
        if (e.key === 'Escape') {
          (e.target as HTMLElement).blur();
        }
        return;
      }

      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        togglePlayback();
      } else if (e.key === 'ArrowRight') {
        if (!activeSession || activeSession.steps.length === 0) return;
        const nextIdx = Math.min(playbackIndex + 1, activeSession.steps.length - 1);
        setPlaybackIndex(nextIdx);
        setActiveStepId(activeSession.steps[nextIdx].id);
      } else if (e.key === 'ArrowLeft') {
        if (!activeSession || activeSession.steps.length === 0) return;
        const prevIdx = Math.max(playbackIndex - 1, 0);
        setPlaybackIndex(prevIdx);
        setActiveStepId(activeSession.steps[prevIdx].id);
      } else if (e.key === 'r' || e.key === 'R') {
        if (!activeSession) return;
        stopPlayback();
        setPlaybackIndex(0);
        setActiveStepId(activeSession.steps[0]?.id || null);
      } else if (e.key >= '1' && e.key <= '9') {
        if (!activeSession) return;
        const idx = parseInt(e.key) - 1;
        if (idx < activeSession.steps.length) {
          setPlaybackIndex(idx);
          setActiveStepId(activeSession.steps[idx].id);
        }
      } else if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        document.getElementById('search-input')?.focus();
      } else if (e.key === 'e' || e.key === 'E') {
        exportTraceJSON();
      } else if (e.key === 'c' || e.key === 'C') {
        setRightPanel(p => p === 'cost' ? 'inspector' : 'cost');
      } else if (e.key === 'b' || e.key === 'B') {
        setRightPanel(p => p === 'budget' ? 'inspector' : 'budget');
      } else if (e.key === 'd' || e.key === 'D') {
        setShowCompare(v => !v);
      } else if (e.key === '?') {
        setShowShortcuts(v => !v);
      } else if (e.key === 'Escape') {
        if (showCompare) setShowCompare(false);
        else if (showShortcuts) setShowShortcuts(false);
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [activeSession, playbackIndex, togglePlayback, stopPlayback, exportTraceJSON, showCompare, showShortcuts]);

  // Handle scrubber click
  const handleScrubberClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!activeSession || activeSession.steps.length === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percent = x / rect.width;
    const idx = Math.min(
      Math.floor(percent * activeSession.steps.length),
      activeSession.steps.length - 1
    );
    setPlaybackIndex(idx);
    setActiveStepId(activeSession.steps[idx].id);
  }, [activeSession]);

  const playbackPercent = activeSession && activeSession.steps.length > 0
    ? ((playbackIndex + 1) / activeSession.steps.length) * 100
    : 0;

  return (
    <div className="app-layout" id="agentlens-app">
      {/* ─── Compare Overlay ─── */}
      {showCompare && (
        <CompareView sessions={sessions} onClose={() => setShowCompare(false)} />
      )}

      {/* ─── Keyboard Shortcuts Modal ─── */}
      {showShortcuts && (
        <KeyboardShortcuts onClose={() => setShowShortcuts(false)} />
      )}

      {/* ─── Header ─── */}
      <header className="header" id="header">
        <div className="header-brand">
          <div className="header-logo">🔍</div>
          <span className="header-title">AgentLens</span>
          <span className="header-subtitle">AI Agent Debugger & Replay Inspector</span>
        </div>
        <div className="header-actions">
          <div className={`header-badge ${hasLiveSessions ? 'live' : 'demo'}`}>
            {hasLiveSessions ? '🟢 LIVE' : '⚡ DEMO MODE'}
          </div>
          <div
            className="header-badge clickable"
            style={{ cursor: 'pointer' }}
            onClick={() => setShowShortcuts(true)}
            title="Keyboard Shortcuts (?)"
          >
            ⌨️ Shortcuts
          </div>
          <div
            className="header-badge clickable live-stream-btn"
            style={{ cursor: 'pointer' }}
            onClick={isLiveStreaming ? stopLiveStream : startLiveStream}
            title="Simulate real-time trace streaming"
          >
            {isLiveStreaming ? '⏹️ Stop Stream' : '📡 Live Stream'}
          </div>
          <div
            className="header-badge clickable"
            style={{ cursor: 'pointer', position: 'relative' }}
            onClick={() => setShowExportMenu(!showExportMenu)}
            title="Export trace (E)"
          >
            📥 Export
            {showExportMenu && (
              <div className="export-dropdown">
                <div className="export-dropdown-item" onClick={(e) => { e.stopPropagation(); exportTraceJSON(); }}>
                  <span>📄</span> JSON (AgentLens)
                </div>
                <div className="export-dropdown-item" onClick={(e) => { e.stopPropagation(); exportTraceOTel(); }}>
                  <span>🔭</span> OpenTelemetry
                </div>
              </div>
            )}
          </div>
          <div
            className="header-badge clickable"
            style={{ cursor: 'pointer' }}
            onClick={() => setShowCompare(true)}
            title="Compare runs (D)"
          >
            🔀 Compare
          </div>
          <div
            className="header-badge clickable"
            style={{ cursor: 'pointer' }}
            onClick={() => setRightPanel(rightPanel === 'cost' ? 'inspector' : 'cost')}
            id="toggle-cost-dashboard"
            title="Toggle Cost Dashboard (C)"
          >
            💰 {rightPanel === 'cost' ? 'Inspector' : 'Cost Dashboard'}
          </div>
          <div
            className={`header-badge clickable ${rightPanel === 'budget' ? 'active-badge' : ''}`}
            style={{ cursor: 'pointer' }}
            onClick={() => setRightPanel(rightPanel === 'budget' ? 'inspector' : 'budget')}
            title="Budget Alerts (B)"
          >
            🚨 Budget
          </div>
        </div>
      </header>

      {/* ─── Sidebar ─── */}
      <aside className="sidebar" id="sidebar">
        <div className="sidebar-section-title">Trace Sessions</div>
        {sessions.map(session => (
          <SessionCard
            key={session.id}
            session={session}
            active={session.id === activeSessionId}
            onClick={() => setActiveSessionId(session.id)}
          />
        ))}

        {/* Agent legend */}
        {activeSession && (
          <>
            <div className="sidebar-section-title" style={{ marginTop: 24 }}>
              Agents ({activeSession.agents.length})
            </div>
            {activeSession.agents.map(agent => (
              <div
                key={agent.name}
                className={`sidebar-agent-item ${filterAgent === agent.name ? 'active-filter' : ''}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 12px',
                  fontSize: 12,
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                  borderRadius: 6,
                  transition: 'background 0.15s',
                }}
                onClick={() => setFilterAgent(filterAgent === agent.name ? '' : agent.name)}
                title={`Click to filter by ${agent.name}`}
              >
                <span style={{
                  width: 10, height: 10, borderRadius: '50%',
                  background: agent.color, flexShrink: 0,
                }} />
                <span style={{ fontWeight: 600, color: agent.color }}>{agent.name}</span>
                <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-tertiary)' }}>
                  {agent.step_count} steps
                </span>
              </div>
            ))}
          </>
        )}
      </aside>

      {/* ─── Main Panel ─── */}
      <div className="main-panel" id="main-panel">
        {activeSession ? (
          <>
            {/* Stats bar */}
            <div className="stats-bar">
              <div className="stat-chip">
                <span className="stat-chip-icon">🕐</span>
                <span className="stat-chip-label">Duration</span>
                <span className="stat-chip-value">{formatDuration(activeSession.total_duration_ms)}</span>
              </div>
              <div className="stat-chip">
                <span className="stat-chip-icon">🧠</span>
                <span className="stat-chip-label">Tokens</span>
                <span className="stat-chip-value">{formatTokens(activeSession.total_tokens)}</span>
              </div>
              <div className="stat-chip">
                <span className="stat-chip-icon">💰</span>
                <span className="stat-chip-label">Cost</span>
                <span className="stat-chip-value cost">{formatCost(activeSession.total_cost)}</span>
              </div>
              <div className="stat-chip">
                <span className="stat-chip-icon">📊</span>
                <span className="stat-chip-label">Steps</span>
                <span className="stat-chip-value">{activeSession.total_steps}</span>
              </div>
              {activeSession.anomaly_count > 0 && (
                <div className="stat-chip">
                  <span className="stat-chip-icon">⚠️</span>
                  <span className="stat-chip-label">Anomalies</span>
                  <span className="stat-chip-value warning">{activeSession.anomaly_count}</span>
                </div>
              )}
            </div>

            {/* Filter toolbar */}
            <FilterToolbar
              session={activeSession}
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              filterAgent={filterAgent}
              setFilterAgent={setFilterAgent}
              filterType={filterType}
              setFilterType={setFilterType}
              filterStatus={filterStatus}
              setFilterStatus={setFilterStatus}
              filteredCount={filteredSteps.length}
              totalCount={activeSession.steps.length}
            />

            {/* Timeline */}
            <div className="timeline-container" id="timeline">
              <div className="timeline">
                {activeSession.steps.map((step, i) => (
                  <TimelineStep
                    key={step.id}
                    step={step}
                    index={i}
                    active={step.id === activeStepId}
                    dimmed={hasActiveFilters && !filteredStepIds.has(step.id)}
                    onClick={() => {
                      setActiveStepId(step.id);
                      setPlaybackIndex(i);
                      setRightPanel('inspector');
                    }}
                  />
                ))}
              </div>
            </div>

            {/* Playback controls */}
            <div className="playback-bar" id="playback">
              <button
                className={`playback-btn ${isPlaying ? 'playing' : ''}`}
                onClick={() => {
                  stopPlayback();
                  setPlaybackIndex(0);
                  setActiveStepId(activeSession.steps[0]?.id || null);
                }}
                title="Reset (R)"
              >
                ⟲
              </button>
              <button
                className={`playback-btn ${isPlaying ? 'playing' : ''}`}
                onClick={togglePlayback}
                title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
                id="play-btn"
              >
                {isPlaying ? '⏸' : '▶'}
              </button>
              <button
                className="playback-btn"
                onClick={() => {
                  if (!activeSession) return;
                  const nextIdx = Math.min(playbackIndex + 1, activeSession.steps.length - 1);
                  setPlaybackIndex(nextIdx);
                  setActiveStepId(activeSession.steps[nextIdx].id);
                }}
                title="Next Step (→)"
              >
                ⏭
              </button>
              <div className="playback-scrubber" onClick={handleScrubberClick}>
                <div className="playback-track">
                  <div className="playback-progress" style={{ width: `${playbackPercent}%` }} />
                  <div className="playback-step-markers">
                    {activeSession.steps.map((step, i) => (
                      <div
                        key={step.id}
                        className="playback-marker"
                        style={{
                          left: `${((i + 0.5) / activeSession.steps.length) * 100}%`,
                          background: step.agent_color,
                          opacity: step.anomalies?.some(a => a.severity === 'critical') ? 1 : 0.4,
                        }}
                      />
                    ))}
                  </div>
                </div>
              </div>
              <span className="playback-time">
                Step {playbackIndex + 1} / {activeSession.steps.length}
              </span>
            </div>
          </>
        ) : (
          <div className="no-session">
            <div className="no-session-icon">🔍</div>
            <div className="no-session-title">Select a Trace Session</div>
            <div className="no-session-desc">
              Choose a session from the sidebar to inspect its timeline, trace steps, and cost breakdown
            </div>
          </div>
        )}
      </div>

      {/* ─── Right Panel: Inspector, Cost Dashboard, or Budget ─── */}
      {rightPanel === 'inspector' ? (
        <InspectorPanel step={activeStep} session={activeSession} />
      ) : rightPanel === 'cost' && activeSession ? (
        <div className="inspector">
          <div className="inspector-header">
            <span className="inspector-title">💰 Cost Dashboard</span>
            <span
              style={{ cursor: 'pointer', fontSize: 12, color: 'var(--text-tertiary)' }}
              onClick={() => setRightPanel('inspector')}
            >
              ← Inspector
            </span>
          </div>
          <CostDashboard session={activeSession} />
        </div>
      ) : rightPanel === 'budget' && activeSession ? (
        <div className="inspector">
          <div className="inspector-header">
            <span className="inspector-title">🚨 Budget Alerts</span>
            <span
              style={{ cursor: 'pointer', fontSize: 12, color: 'var(--text-tertiary)' }}
              onClick={() => setRightPanel('inspector')}
            >
              ← Inspector
            </span>
          </div>
          <BudgetAlerts
            session={activeSession}
            budgetLimit={budgetLimit}
            setBudgetLimit={setBudgetLimit}
            tokenLimit={tokenLimit}
            setTokenLimit={setTokenLimit}
          />
        </div>
      ) : (
        <InspectorPanel step={null} session={null} />
      )}
    </div>
  );
}
