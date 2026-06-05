# syntax=docker/dockerfile:1

# Stage 1: Install dependencies
FROM node:26-alpine AS deps
WORKDIR /app

# Install pnpm (pinned to match dev environment)
RUN npm install -g pnpm@10.32.1

# Copy root workspace files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY web/package.json ./web/
COPY web/prisma ./web/prisma/

# Approve build scripts for native dependencies and install
RUN printf 'onlyBuiltDependencies[]=@parcel/watcher\nonlyBuiltDependencies[]=@prisma/engines\nonlyBuiltDependencies[]=@swc/core\nonlyBuiltDependencies[]=esbuild\nonlyBuiltDependencies[]=msw\nonlyBuiltDependencies[]=prisma\nonlyBuiltDependencies[]=sharp\n' > .npmrc \
    && pnpm install --filter ./web --frozen-lockfile

# Stage 2: Build the application
FROM node:26-alpine AS builder
WORKDIR /app

RUN npm install -g pnpm@10.32.1

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/web/node_modules ./web/node_modules
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY web ./web

# Set environment variables for build
ARG NEXT_PUBLIC_APP_VERSION=dev
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
ENV NEXT_PUBLIC_APP_VERSION=$NEXT_PUBLIC_APP_VERSION
# Build-time placeholders (overridden at runtime)
ENV BETTER_AUTH_URL=http://localhost:3000
ENV BETTER_AUTH_SECRET=build-time-placeholder-secret-key
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build

# Build the application
WORKDIR /app/web
RUN pnpm build

# Stage 3: Production runner
FROM node:26-alpine AS runner
WORKDIR /app

ARG NEXT_PUBLIC_APP_VERSION=dev
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_PUBLIC_APP_VERSION=$NEXT_PUBLIC_APP_VERSION

# Create non-root user
RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 nextjs

# Copy pnpm-installed dependencies so Prisma CLI is available at runtime
COPY --from=deps --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=deps --chown=nextjs:nodejs /app/web/node_modules ./web/node_modules

# Copy standalone server output
COPY --from=builder --chown=nextjs:nodejs /app/web/.next/standalone ./
# Next serves static assets relative to /app/web/server.js inside standalone
COPY --from=builder --chown=nextjs:nodejs /app/web/.next/static ./web/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/web/public ./web/public

# Copy Prisma schema, migrations, and config for migrate deploy
COPY --from=builder --chown=nextjs:nodejs /app/web/package.json ./web/package.json
COPY --from=builder --chown=nextjs:nodejs /app/web/prisma ./web/prisma
COPY --from=builder --chown=nextjs:nodejs /app/web/prisma.config.ts ./web/prisma.config.ts

# Copy Prisma generated client
COPY --from=builder --chown=nextjs:nodejs /app/web/generated ./generated

COPY --chown=nextjs:nodejs web/docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
ENV RUN_DB_MIGRATIONS=1

CMD ["./docker-entrypoint.sh"]
