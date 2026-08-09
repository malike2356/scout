# Scout dashboard production image
FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --dangerously-allow-all-builds 2>/dev/null \
  || pnpm install --dangerously-allow-all-builds

FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV CI=true
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG NEXT_PUBLIC_SCOUT_API_URL=https://console.labyrinthscout.com
ENV NEXT_PUBLIC_SCOUT_API_URL=$NEXT_PUBLIC_SCOUT_API_URL
RUN ./node_modules/.bin/next build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3005
RUN useradd -m -u 10001 scout
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
USER scout
EXPOSE 3005
CMD ["node", "server.js"]
