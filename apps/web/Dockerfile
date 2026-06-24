# syntax=docker/dockerfile:1
# Self-host / docker-compose build. Vercel ignores this file (builds Next natively).
FROM node:20-alpine AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
# Standalone build: web has no workspace deps → no root pnpm-lock in context.
COPY package.json .npmrc ./
RUN pnpm install --no-frozen-lockfile
COPY . .
# NEXT_PUBLIC_* is inlined at build time → must be present before `next build`.
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN pnpm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
USER appuser
EXPOSE 3000
CMD ["node", "server.js"]
