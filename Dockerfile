# ─── AgentLens ───────────────────────────────────────────────────────────
# Multi-stage Docker build for production deployment
# Usage:
#   docker build -t agentlens .
#   docker run -p 3000:3000 agentlens
# ─────────────────────────────────────────────────────────────────────────

FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files first for better layer caching
COPY package.json package-lock.json ./
RUN npm ci --prefer-offline --no-audit

# Copy source
COPY . .

# Build Next.js
RUN npm run build

# ─── Production stage ───────────────────────────────────────────────────

FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Create non-root user and writable persistence directory
RUN addgroup --system agentlens && adduser --system --ingroup agentlens agentlens \
    && mkdir -p /app/.data && chown -R agentlens:agentlens /app/.data

# Copy built application
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# Copy SDK files so they're accessible from the container
COPY --from=builder /app/sdk ./sdk
COPY --from=builder /app/src/mcp-server-entry.mts ./src/mcp-server-entry.mts

USER agentlens

EXPOSE 3000

CMD ["node", "server.js"]
