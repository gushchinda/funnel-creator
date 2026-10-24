# Funnel image for Cloud Run (or any Docker host). Build context = the funnel folder (server/ and web/).
FROM node:22-slim
ENV NODE_ENV=production PORT=8080
WORKDIR /app
COPY server/package*.json server/
RUN cd server && (npm ci --omit=dev || npm install --omit=dev) && npm cache clean --force
COPY funnel.config.json ./
COPY server/ server/
COPY web/ web/
USER node
CMD ["node", "server/server.js"]
