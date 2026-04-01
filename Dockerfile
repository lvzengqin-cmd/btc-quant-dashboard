FROM node:22-slim AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY client/ ./client/
RUN npm run build:client --prefix client/btc-quant-client

COPY server/ ./server/

FROM node:22-slim

WORKDIR /app

COPY --from=builder /app/client/btc-quant-client/dist ./client/btc-quant-client/dist
COPY --from=builder /app/server ./server
COPY --from=builder /app/package.json ./
COPY --from=builder /app/package-lock.json* ./

RUN npm ci

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["node", "server/index.js"]
