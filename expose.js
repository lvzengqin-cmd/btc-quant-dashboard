#!/usr/bin/env node
/**
 * 反向代理服务器
 * 把本地的 3791 端口（后端）暴露到所有网络接口的 8080 端口
 * 这样前端可以通过 http://139.224.49.92:8080 访问 API
 */
import { createServer } from 'http';

const LOCAL_API = 'http://127.0.0.1:3791';
const EXPOSE_PORT = 8080;
const HOST = '0.0.0.0';

const server = createServer((req, res) => {
  const url = LOCAL_API + req.url;
  console.log(`${req.method} ${req.url} -> ${url}`);

  const options = {
    hostname: '127.0.0.1',
    port: 3791,
    path: req.url,
    method: req.method,
    headers: { ...req.headers, 'host': undefined },
  };

  const proxyReq = require('http').request(options, (proxyRes) => {
    // 允许 CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (e) => {
    console.error('代理错误:', e.message);
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Backend unavailable', detail: e.message }));
  });

  req.pipe(proxyReq);
});

server.listen(EXPOSE_PORT, HOST, () => {
  console.log(`✅ 反向代理已启动: http://${HOST}:${EXPOSE_PORT}`);
  console.log(`📡 API 入口: http://139.224.49.92:${EXPOSE_PORT}`);
  console.log(`🔗 示例: http://139.224.49.92:${EXPOSE_PORT}/api/market/price`);
});
