FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html tsconfig*.json vite.config.ts ./
COPY src ./src
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 WEBOBSIDIAN_VAULT_DIR=/data/vault
COPY --from=build /app/dist ./dist
COPY server ./server
RUN mkdir -p /data/vault && chown -R node:node /data
USER node
EXPOSE 3000
CMD ["node", "server/server.mjs"]
