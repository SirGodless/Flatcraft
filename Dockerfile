# Build stage: compile the browser client and bundle the dedicated server.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/sim/package.json packages/sim/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
COPY packages/dedicated/package.json packages/dedicated/
RUN npm ci
COPY . .
RUN npm run build

# Runtime stage: one small self-contained server bundle + the static
# client. No node_modules needed at runtime.
FROM node:22-alpine
ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data \
    CLIENT_DIR=/app/client
WORKDIR /app
COPY --from=build /app/packages/dedicated/dist/server.mjs ./server.mjs
COPY --from=build /app/packages/client/dist ./client
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8080
CMD ["node", "server.mjs"]
