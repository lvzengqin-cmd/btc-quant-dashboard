import express from 'express';
import axios from 'axios';
import {
  getSetting, setSetting, getSignalHistory, getActiveSignals,
  getDailyStats, getTotalStats, getFactorPerformance,
  getRecentLossTrades,
  getSetting as gs, setSetting as ss
} from './models/db.js';
import { runSignalCheck } from './services/signalService.js';
import { addWSClient } from './services/signalService.js';
import { fetchAllKlines, getCurrentPrice } from './services/binanceService.js';
import { scoreAllFactors } from './services/factorEngine.js';
import { getLearningInsights } from './services/learningService.js';

const router = express.Router();

// ========== 市场数据 ==========
router.get('/api/market/price', async (req, res) => {
  try {
    const price = await getCurrentPrice();
    res.json({ price, ts: Date.now() });
  } catch { res.status(500).json({ error: 'Failed to fetch price' }); }
});

router.get('/api/market/klines', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 200;
    const klines = await fetchAllKlines(limit);
    res.json(klines);
  } catch { res.status(500).json({ error: 'Failed to fetch klines' }); }
});

router.get('/api/market/score', async (req, res) => {
  try {
    const klines = await fetchAllKlines(200);
    if (!klines['5m'] || klines['5m'].length < 30) return res.status(503).json({ error: 'Not enough data' });
    const score = scoreAllFactors(klines);
    res.json(score);
  } catch { res.status(500).json({ error: 'Failed to score' }); }
});

// ========== 信号 ==========
router.get('/api/signals/history', (req, res) => {
  const limit = parseInt(req.query.limit) || 100;
  res.json(getSignalHistory(limit));
});

router.get('/api/signals/active', (req, res) => {
  res.json(getActiveSignals());
});

// ========== 统计 ==========
router.get('/api/stats/daily', (req, res) => {
  const days = parseInt(req.query.days) || 30;
  res.json(getDailyStats(days));
});

router.get('/api/stats/total', (req, res) => {
  res.json(getTotalStats());
});

router.get('/api/stats/factors', (req, res) => {
  const regime = req.query.regime || null;
  res.json(getFactorPerformance(regime));
});

router.get('/api/stats/learning', (req, res) => {
  const days = parseInt(req.query.days) || 7;
  res.json(getLearningInsights(days));
});

router.get('/api/stats/loss-trades', (req, res) => {
  const days = parseInt(req.query.days) || 7;
  res.json(getRecentLossTrades(days, 20));
});

// ========== 设置 ==========
router.get('/api/settings', (req, res) => {
  const keys = ['webhook_long_url', 'webhook_short_url', 'confidence_threshold', 'auto_check_enabled'];
  const settings = {};
  keys.forEach(k => { settings[k] = gs(k) || ''; });
  res.json(settings);
});

router.post('/api/settings', (req, res) => {
  const { key, value } = req.body;
  if (!key) return res.status(400).json({ error: 'key required' });
  ss(key, String(value));
  res.json({ ok: true, key, value });
});

// ========== 手动触发检测 ==========
router.post('/api/check', async (req, res) => {
  await runSignalCheck();
  res.json({ ok: true, ts: new Date().toISOString() });
});

// ========== WebSocket (ws://...) ==========
export function setupWS(wss) {
  wss.on('connection', (ws) => {
    addWSClient(ws);
    ws.on('error', () => {});
    // 发送当前状态
    ws.send(JSON.stringify({ type: 'connected', ts: Date.now() }));
  });
}

export default router;
