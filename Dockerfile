# Build stage: compile the browser client and bundle the dedicated server.
FROM node:22-alpine AS build
WORKDIR /app
# isolated-vm (the Stage 8 script sandbox) ships no musl prebuild, so it
# must compile from source here - same toolchain isolated-vm's own
# Dockerfile.alpine uses for exactly this reason.
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
COPY packages/sim/package.json packages/sim/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
COPY packages/content/package.json packages/content/
COPY packages/dedicated/package.json packages/dedicated/
RUN npm ci
COPY . .
RUN npm run build

# Runtime stage: the server bundle + the static client, plus the two
# runtime dependencies server.mjs can't have inlined into it - esbuild
# (its synchronous transform API spawns worker_threads.Worker(__filename)
# internally, which breaks the moment esbuild's own code is bundled into
# the file __filename then points at - see sandbox.ts's doc comment) and
# isolated-vm (a native addon, never bundleable). Both are marked
# --external in dedicated/package.json's build script for that reason,
# which means they have to physically exist as real packages at runtime
# instead - copied here from the build stage rather than reinstalled, so
# the already-compiled/-fetched binaries (matched to this exact base
# image) come along unchanged. node-gyp-build is isolated-vm's own only
# runtime dependency (it locates isolated-vm's compiled .node binary at
# require time) - esbuild has none beyond the @esbuild/<platform> package
# already copied alongside it.
FROM node:22-alpine
ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data \
    CLIENT_DIR=/app/client
WORKDIR /app
COPY --from=build /app/node_modules/isolated-vm ./node_modules/isolated-vm
COPY --from=build /app/node_modules/node-gyp-build ./node_modules/node-gyp-build
COPY --from=build /app/node_modules/esbuild ./node_modules/esbuild
COPY --from=build /app/node_modules/@esbuild ./node_modules/@esbuild
COPY --from=build /app/packages/dedicated/dist/server.mjs ./server.mjs
COPY --from=build /app/packages/client/dist ./client
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8080
CMD ["node", "server.mjs"]
