FROM node:22-alpine AS builder

WORKDIR /app

# Install root deps
COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts

# Install client deps and build frontend
COPY client/ ./client/
RUN npm run build:client --prefix client/btc-quant-client

# Install server deps
RUN npm install --prefix . 

# Production stage
FROM node:22-alpine

WORKDIR /app

COPY --from=builder /app/client/btc-quant-client/dist ./client/btc-quant-client/dist
COPY --from=builder /app/server ./server
COPY --from=builder /app/package.json ./

RUN npm ci --omit=dev --ignore-scripts

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["node", "server/index.js"]
