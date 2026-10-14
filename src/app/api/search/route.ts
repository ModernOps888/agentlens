// ─── Search API ─────────────────────────────────────────────────────────────
// GET /api/search?q=...&agent=...&type=...&limit=...
// Search across all sessions by text, agent name, step type, or tool name.
// Used by the AgentLens MCP server for IDE integration.

import { NextResponse } from 'next/server';
import { traceStore } from '@/lib/trace-store';
import { demoSessions } from '@/lib/demo-data';
import type { TraceStep } from '@/lib/types';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q') || '';
    const agentFilter = searchParams.get('agent') || '';
    const typeFilter = searchParams.get('type') || '';
    const statusFilter = searchParams.get('status') || '';
    const sessionFilter = searchParams.get('session') || '';
    const parsedLimit = parseInt(searchParams.get('limit') || '50', 10);
    const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 200) : 50;

    const liveSessions = traceStore.getAllSessions();
    const liveIds = new Set(liveSessions.map(s => s.id));
    const sessions = [...liveSessions, ...demoSessions.filter(s => !liveIds.has(s.id))];
    const results: Array<{
      session_id: string;
      session_name: string;
      step: TraceStep;
    }> = [];

    for (const session of sessions) {
      // Skip if filtering by specific session
      if (sessionFilter && session.id !== sessionFilter) continue;

      for (const step of session.steps) {
        // Agent filter
        if (agentFilter && step.agent_name !== agentFilter) continue;

        // Type filter
        if (typeFilter && step.step_type !== typeFilter) continue;

        // Status filter
        if (statusFilter && step.status !== statusFilter) continue;

        // Text search across all fields
        if (query) {
          const searchText = [
            step.prompt,
            step.response,
            step.system_prompt,
            step.tool_name,
            step.error_message,
            step.decision_reason,
            step.spawned_agent,
            step.mcp?.server_name,
            step.mcp?.tool_name,
            step.agent_name,
            step.model,
          ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();

          if (!searchText.includes(query.toLowerCase())) continue;
        }

        results.push({
          session_id: session.id,
          session_name: session.name,
          step,
        });

        if (results.length >= limit) break;
      }

      if (results.length >= limit) break;
    }

    return NextResponse.json({
      query,
      total: results.length,
      results,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
