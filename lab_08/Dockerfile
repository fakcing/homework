# syntax=docker/dockerfile:1
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY shared/package.json ./shared/package.json
COPY server/package.json ./server/package.json
COPY client/package.json ./client/package.json
RUN npm ci
COPY . .
ARG GIT_SHA=dev
ENV GIT_SHA=$GIT_SHA
RUN npm run build:server && npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    CLIENT_DIST=/app/client/dist \
    LOG_DIR=/app/logs \
    LOG_STDOUT=1 \
    GIT_SHA=dev
RUN mkdir -p /app/logs && chown -R node:node /app
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node shared/package.json ./shared/package.json
COPY --chown=node:node server/package.json ./server/package.json
COPY --chown=node:node client/package.json ./client/package.json
RUN npm ci --omit=dev --ignore-scripts
COPY --from=build --chown=node:node /app/dist/server/index.js /app/dist/server/index.js
COPY --from=build --chown=node:node /app/client/dist /app/client/dist
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server/index.js"]
