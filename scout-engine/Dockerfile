# Multi-stage production image for Scout Engine (SaaS)
FROM node:22-bookworm-slim AS deps
WORKDIR /app
# Skip Chromium download during image build (hangs/slow on some hosts).
# PDF/report features that need Puppeteer can install Chrome at runtime if required.
ENV PUPPETEER_SKIP_DOWNLOAD=1
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=1
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --dangerously-allow-all-builds 2>/dev/null \
  || pnpm install --dangerously-allow-all-builds

FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV CI=true
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY package.json pnpm-lock.yaml tsconfig.json ./
COPY src ./src
COPY public ./public
RUN ./node_modules/.bin/tsc
RUN mkdir -p dist/security && cp src/security/injection-patterns.json dist/security/
RUN mkdir -p dist/db/migrations && cp src/db/migrations/*.sql dist/db/migrations/

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN useradd -m -u 10001 scout && corepack enable
COPY --from=build /app/package.json /app/pnpm-lock.yaml ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/src ./src
COPY --from=build /app/public ./public
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh && chown -R scout:scout /app
USER scout
EXPOSE 4444
ENTRYPOINT ["/entrypoint.sh"]
