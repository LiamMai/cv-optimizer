FROM node:20-alpine AS builder
WORKDIR /app
# Use the system Chromium at runtime — don't download puppeteer's (glibc) build on musl.
ENV PUPPETEER_SKIP_DOWNLOAD=true
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app

# Chromium + the libraries/fonts headless rendering needs (HTML→PDF export).
RUN apk add --no-cache \
      chromium \
      nss \
      freetype \
      harfbuzz \
      ca-certificates \
      ttf-freefont \
      font-noto \
      font-noto-cjk
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

RUN addgroup -S appgroup && adduser -S appuser -G appgroup
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
COPY package.json ./
RUN mkdir -p uploads && chown appuser:appgroup uploads
USER appuser
EXPOSE 3001
CMD ["node", "dist/index.js"]
