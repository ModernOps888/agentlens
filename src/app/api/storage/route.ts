// ─── Storage Configuration API ──────────────────────────────────────────────
// GET  /api/storage — View current config and stats
// POST /api/storage — Update storage configuration (sampling, TTL, limits)

import { NextResponse } from 'next/server';
import { traceStore } from '@/lib/trace-store';

export async function GET() {
  return NextResponse.json({
    config: traceStore.getConfig(),
    stats: traceStore.getStats(),
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    // Validate and apply config updates
    const updates: Record<string, unknown> = {};

    if (typeof body.samplingRate === 'number' && Number.isFinite(body.samplingRate)) {
      updates.samplingRate = Math.max(0, Math.min(1, body.samplingRate));
    }
    if (typeof body.ttlMs === 'number' && Number.isFinite(body.ttlMs)) {
      updates.ttlMs = Math.max(0, body.ttlMs);
    }
    if (typeof body.maxSessions === 'number' && Number.isFinite(body.maxSessions)) {
      updates.maxSessions = Math.max(0, Math.floor(body.maxSessions));
    }
    if (typeof body.maxStepsPerSession === 'number' && Number.isFinite(body.maxStepsPerSession)) {
      updates.maxStepsPerSession = Math.max(0, Math.floor(body.maxStepsPerSession));
    }
    if (typeof body.storePayloads === 'boolean') {
      updates.storePayloads = body.storePayloads;
    }
    if (typeof body.maxPayloadChars === 'number' && Number.isFinite(body.maxPayloadChars)) {
      updates.maxPayloadChars = Math.max(0, Math.floor(body.maxPayloadChars));
    }

    traceStore.configure(updates);

    // Force a cleanup if requested
    if (body.forceCleanup) {
      traceStore.cleanup();
    }

    return NextResponse.json({
      ok: true,
      config: traceStore.getConfig(),
      stats: traceStore.getStats(),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
