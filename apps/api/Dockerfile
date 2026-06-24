# syntax=docker/dockerfile:1
# ---------------------------------------------------------------------------
# Builder — install deps, generate Prisma client, compile TS.
# Standalone build: apps/api has no workspace deps (does not import shared),
# so the build context is apps/api itself. No root pnpm-lock needed here.
# ---------------------------------------------------------------------------
FROM node:20-alpine AS builder
WORKDIR /app
# Don't download puppeteer's bundled (glibc) Chromium on musl — system Chromium is used at runtime.
ENV PUPPETEER_SKIP_DOWNLOAD=true
# openssl so `prisma generate` detects libssl and bundles the right musl engine.
RUN apk add --no-cache openssl
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
# Standalone build (apps/api has no workspace deps) → no root pnpm-lock in context.
COPY package.json .npmrc ./
RUN pnpm install --no-frozen-lockfile
COPY . .
RUN pnpm exec prisma generate
RUN pnpm run build
# Note: dev deps are kept — the `prisma` CLI (a devDependency) runs `db push` at boot.

# ---------------------------------------------------------------------------
# Runtime — system Chromium + fonts for HTML→PDF export (exporter.ts).
# ---------------------------------------------------------------------------
FROM node:20-alpine
WORKDIR /app

RUN apk add --no-cache \
      openssl \
      chromium \
      nss \
      freetype \
      harfbuzz \
      ca-certificates \
      ttf-freefont \
      font-noto \
      font-noto-cjk
ENV NODE_ENV=production \
    PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

RUN addgroup -S appgroup && adduser -S appuser -G appgroup
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
COPY package.json ./
RUN mkdir -p uploads && chown appuser:appgroup uploads
USER appuser

EXPOSE 3001
# Sync schema to the DB (no migrations dir → db push), then start.
# --accept-data-loss: db push refuses destructive changes (dropped column/table) without it.
# Fine while the DB is disposable; switch to `prisma migrate deploy` before you carry real user data.
CMD ["sh", "-c", "./node_modules/.bin/prisma db push --skip-generate --accept-data-loss && node dist/index.js"]
