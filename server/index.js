import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'url';
import path from 'path';
import { readFileSync } from 'fs';
import routes, { setupWS } from './routes.js';
import { startWebSocket, getLastPrice, getCurrentPrice } from './services/binanceService.js';
import { runSignalCheck, addWSClient } from './services/signalService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3456;

// Middleware
app.use(cors());
app.use(express.json());

// 静态文件（前端build）
const distPath = path.join(__dirname, '../client/dist');
app.use(express.static(distPath));

// API路由
app.use('/', routes);

// WebSocket
const server = createServer(app);
const wss = new WebSocketServer({ server });
setupWS(wss);

// 实时价格 → WebSocket广播
startWebSocket(async (tick) => {
  const msg = JSON.stringify({ type: 'tick', ...tick });
  wss.clients.forEach(ws => { try { ws.send(msg); } catch {} });
});

// 启动
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 BTC量化信号系统已启动`);
  console.log(`📊 面板: http://localhost:${PORT}`);
  console.log(`🔌 WebSocket: ws://localhost:${PORT}`);
  console.log(`📡 币安: 已连接\n`);
  // 首次检测
  setTimeout(() => runSignalCheck(), 3000);
  // 每5分钟检测
  setInterval(() => runSignalCheck(), 5 * 60 * 1000);
});
