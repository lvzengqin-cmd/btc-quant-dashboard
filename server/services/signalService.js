import axios from 'axios';
import { randomUUID } from 'crypto';
import {
  insertSignal, settleSignal, updateDailyStat,
  updateFactorPerformance, getSetting, getActiveSignals
} from '../models/db.js';
import { scoreAllFactors } from './factorEngine.js';
import { fetchAllKlines, getCurrentPrice } from './binanceService.js';

let lastCheckTime = 0;
const CHECK_INTERVAL = 5 * 60 * 1000;
const wsClients = new Set();

export function addWSClient(ws) { wsClients.add(ws); ws.on('close', () => wsClients.delete(ws)); }

function broadcastSignal(data) {
  const msg = JSON.stringify({ type: 'signal', ...data });
  wsClients.forEach(ws => { try { ws.send(msg); } catch {} });
}

function broadcastSignalResult(data) {
  const msg = JSON.stringify({ type: 'signal_result', ...data });
  wsClients.forEach(ws => { try { ws.send(msg); } catch {} });
}

export async function runSignalCheck() {
  const now = Date.now();
  if (now - lastCheckTime < CHECK_INTERVAL - 1000) return;
  lastCheckTime = now;
  console.log(`[${new Date().toISOString()}] 检测信号中...`);
  try {
    const klines = await fetchAllKlines(200);
    if (!klines['5m'] || klines['5m'].length < 30) return;
    const scoreResult = scoreAllFactors(klines);
    if (!scoreResult) return;
    const { regime, confidence, direction, rawScore, longSignals, shortSignals, activeFactors, indicators } = scoreResult;
    const activeSigs = getActiveSignals();
    if (activeSigs.length > 0) return;
    const confidenceThreshold = parseFloat(getSetting('confidence_threshold', '70') || '70');
    const currentPrice = await getCurrentPrice();
    console.log(`[Check] regime=${regime} conf=${confidence}% dir=${direction} (long=${longSignals} short=${shortSignals})`);
    if (direction !== 'neutral' && confidence >= confidenceThreshold) {
      await triggerSignal({ direction, confidence, entryPrice: currentPrice, regime, activeFactors, indicators, rawScore });
    }
  } catch (err) {
    console.error('[Check] Error:', err.message);
  }
}

async function triggerSignal({ direction, confidence, entryPrice, regime, activeFactors, indicators }) {
  const signalId = randomUUID();
  const entryTime = new Date();
  const expireTime = new Date(entryTime.getTime() + 30 * 60 * 1000);
  const factorNames = activeFactors.map(f => f.name);
  insertSignal({ signal_id: signalId, direction, entry_price: entryPrice, entry_time: entryTime.toISOString(), expire_time: expireTime.toISOString(), confidence, regime, factors_used: JSON.stringify(factorNames) });
  const webhookKey = direction === 'long' ? 'webhook_long_url' : 'webhook_short_url';
  const webhookUrl = getSetting(webhookKey);
  const payload = { signal_id: signalId, direction, entry_price: entryPrice, entry_time: entryTime.toISOString(), expire_time: expireTime.toISOString(), confidence, regime, factors: factorNames, message: direction === 'long' ? `🟢 做多信号 置信度${confidence}%` : `🔴 做空信号 置信度${confidence}%` };
  if (webhookUrl) {
    try { await axios.post(webhookUrl, payload, { timeout: 8000 }); console.log(`[Signal] ✅ 已触发 ${direction} Webhook`); }
    catch (err) { console.error(`[Signal] ❌ Webhook失败: ${err.message}`); }
  }
  broadcastSignal({ signalId, direction, confidence, entryPrice, regime, activeFactors, indicators, entryTime: entryTime.toISOString() });
  scheduleSettlement(signalId, entryPrice, direction, factorNames, regime, expireTime);
}

function scheduleSettlement(signalId, entryPrice, direction, factorNames, regime, expireTime) {
  const delay = new Date(expireTime).getTime() - Date.now();
  setTimeout(() => settleSignalNow(signalId, entryPrice, direction, factorNames, regime), Math.max(delay, 0));
}

async function settleSignalNow(signalId, entryPrice, direction, factorNames, regime) {
  try {
    const currentPrice = await getCurrentPrice();
    const settleTime = new Date().toISOString();
    const priceChange = (currentPrice - entryPrice) / entryPrice;
    const isWin = direction === 'long' ? priceChange > 0 : priceChange < 0;
    const result = isWin ? 'win' : 'loss';
    const pnl = direction === 'long' ? priceChange : -priceChange;
    settleSignal(signalId, result, currentPrice, settleTime, pnl);
    updateDailyStat(settleTime.split('T')[0], direction, result);
    for (const fn of factorNames) updateFactorPerformance(fn, regime, isWin, 70);
    if (!isWin) {
      const { adjustFactorWeightsForLoss, logLearning } = await import('./learningService.js');
      const adjustments = adjustFactorWeightsForLoss(factorNames, regime);
      adjustments.forEach(a => logLearning(settleTime.split('T')[0], signalId, 'factor_low_winrate', JSON.stringify(a), factorNames));
    }
    broadcastSignalResult({ signalId, direction, entryPrice, currentPrice, result, pnl, settleTime });
    console.log(`[Settle] #${signalId} ${result} entry=${entryPrice} settle=${currentPrice} pnl=${pnl.toFixed(4)}`);
  } catch (err) {
    console.error('[Settle] Error:', err.message);
  }
}
