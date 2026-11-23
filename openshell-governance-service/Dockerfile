# Production image for the OpenShell governance extension service.
# src/gen/ (protobuf stubs) is committed. The vendored OpenShell proto
# source is not in this public repo, so this image does not run `npm run gen`.
# tsc compiles the committed stubs with the rest of src/. See README.md.
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
RUN ./node_modules/.bin/tsc -p tsconfig.json

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN useradd -m -u 10001 governance
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
USER governance
EXPOSE 18080 18082
CMD ["node", "dist/src/index.js"]
