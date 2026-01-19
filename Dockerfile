# ═══════════════════════════════════════════════════════════════════════════
# TURBINE - Autonomous Software Generation Engine
# ═══════════════════════════════════════════════════════════════════════════
#
# Usage:
#   docker build -t turbine .
#   docker run -v $(pwd)/output:/workspace turbine "Build a REST API for todos"
#

# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Install build dependencies for better-sqlite3
RUN apk add --no-cache python3 make g++

# Copy package files
COPY package.json package-lock.json* ./

# Install dependencies
RUN npm ci

# Copy source
COPY tsconfig.json ./
COPY src ./src

# Build TypeScript
RUN npm run build

# Production stage
FROM node:20-alpine AS production

WORKDIR /app

# Install runtime dependencies for better-sqlite3
RUN apk add --no-cache python3 make g++

# Install Claude Code CLI (or alternative)
# Note: This would need the actual Claude Code installation
# For now, we'll set up the structure for when it's available
RUN npm install -g @anthropic/claude-code || true

# Copy built files
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules

# Create workspace directory
RUN mkdir -p /workspace

# Set working directory for generated projects
WORKDIR /workspace

# Environment variables
ENV NODE_ENV=production
ENV TURBINE_WORK_DIR=/workspace
ENV ANTHROPIC_API_KEY=""

# Entry point
ENTRYPOINT ["node", "/app/dist/cli.js"]

# Default command (shows help if no prompt provided)
CMD ["--help"]

# ═══════════════════════════════════════════════════════════════════════════
# LABELS
# ═══════════════════════════════════════════════════════════════════════════

LABEL org.opencontainers.image.title="Turbine"
LABEL org.opencontainers.image.description="Autonomous Software Generation Engine"
LABEL org.opencontainers.image.source="https://github.com/artpar/turbine"
LABEL org.opencontainers.image.licenses="MIT"
