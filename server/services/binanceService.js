// ============================================================
//  币安市场数据服务 - 修复版
//  Binance Market Data Service (Spot + Fallback)
// ============================================================

import axios from 'axios';

// 多节点故障转移 - Railway IP被封锁时自动切换
const BINANCE_BASES = [
  'https://api.binance.com',
  'https://api-gcp.binance.com',
  'https://api1.binance.com',
  'https://api2.binance.com',
  'https://api3.binance.com',
  'https://api4.binance.com',
];
let currentBaseIndex = 0;
const BINANCE_BASE = () => BINANCE_BASES[currentBaseIndex % BINANCE_BASES.length];
const SYMBOL = 'BTCUSDT';

// 标记哪个节点可用
function nextBase() {
  currentBaseIndex++;
  console.log(`[Binance] 切换到节点: ${BINANCE_BASES[currentBaseIndex % BINANCE_BASES.length]}`);
}

// CoinGecko 备用（Railway完全被封时）
const COINGECKO_URL = 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vscurrencies=usdt&include_24hr=true';

let lastPrices = {};
let wsConnection = null;
let httpPollingTimer = null;
const POLL_INTERVAL_MS = 5000;

const BINANCE_SPOT_TICKER = `wss://stream.binance.com:9443/ws/btcusdt@ticker`;

function startHTTPPolling(onUpdate) {
  if (httpPollingTimer) clearInterval(httpPollingTimer);
  const poll = async () => {
    try {
      const resp = await axios.get(`${BINANCE_BASE()}/api/v3/ticker/24hr`, {
        params: { symbol: SYMBOL },
        timeout: 8000,
      });
      const d = resp.data;
      const price = parseFloat(d.lastPrice);
      lastPrices[SYMBOL] = price;
      if (onUpdate) onUpdate({
        price,
        change24h: parseFloat(d.priceChangePercent),
        high24h: parseFloat(d.highPrice),
        low24h: parseFloat(d.lowPrice),
        volume24h: parseFloat(d.volume),
        open24h: parseFloat(d.openPrice),
      });
    } catch (err) {
      const status = err.response?.status;
      if (status === 451 || status === 403 || status === 429) {
        console.warn(`[Binance ${BINANCE_BASE()}] 节点被封，切换中...`);
        nextBase();
      } else {
        console.error(`[Binance ${BINANCE_BASE()}] 错误: ${err.message}`);
      }
      // Binance全被封时用CoinGecko备用
      try {
        const cgResp = await axios.get(COINGECKO_URL, { timeout: 8000 });
        const price = parseFloat(cgResp.data.bitcoin.usdt);
        lastPrices[SYMBOL] = price;
        if (onUpdate) onUpdate({ price, change24h: 0, high24h: 0, low24h: 0, volume24h: 0, open24h: price });
        console.log(`[CoinGecko] 备用数据生效，价格: $${price}`);
      } catch (cgErr) {
        console.error('[CoinGecko] 备用也挂了:', cgErr.message);
      }
    }
  };
  poll();
  httpPollingTimer = setInterval(poll, POLL_INTERVAL_MS);
  console.log('[Binance] 已启动HTTP轮询 (每' + POLL_INTERVAL_MS / 1000 + '秒)');
}

export function startWebSocket(onPriceUpdate) {
  // 先停止之前的轮询和连接
  if (httpPollingTimer) { clearInterval(httpPollingTimer); httpPollingTimer = null; }
  if (wsConnection) { wsConnection.terminate(); wsConnection = null; }

  try {
    wsConnection = new WebSocket(BINANCE_SPOT_TICKER);
    wsConnection.onopen = () => {
      console.log('[Binance WS] 已连接 ' + BINANCE_SPOT_TICKER);
      if (httpPollingTimer) { clearInterval(httpPollingTimer); httpPollingTimer = null; }
    };
    wsConnection.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.s === SYMBOL) {
          const price = parseFloat(data.c);
          lastPrices[SYMBOL] = price;
          if (onPriceUpdate) onPriceUpdate({
            price,
            change24h: parseFloat(data.P),
            high24h: parseFloat(data.h),
            low24h: parseFloat(data.l),
            volume24h: parseFloat(data.v),
            open24h: parseFloat(data.o),
          });
        }
      } catch {}
    };
    wsConnection.onerror = (e) => {
      console.error('[Binance WS] 错误，切换到HTTP轮询');
      wsConnection = null;
      startHTTPPolling(onPriceUpdate);
    };
    wsConnection.onclose = () => {
      console.log('[Binance WS] 连接关闭，切换到HTTP轮询');
      wsConnection = null;
      startHTTPPolling(onPriceUpdate);
    };
  } catch (err) {
    console.error('[Binance WS] 启动失败，使用HTTP轮询:', err.message);
    startHTTPPolling(onPriceUpdate);
  }
}

export function stopWebSocket() {
  if (wsConnection) { wsConnection.terminate(); wsConnection = null; }
  if (httpPollingTimer) { clearInterval(httpPollingTimer); httpPollingTimer = null; }
}

export function getLastPrice() {
  return lastPrices[SYMBOL] || 0;
}

// K线间隔映射
const INTERVALS = {
  '1m':  { binance: '1m',  label: '1分钟',  max: 600 },
  '3m':  { binance: '3m',  label: '3分钟',  max: 600 },
  '5m':  { binance: '5m',  label: '5分钟',  max: 600 },
  '15m': { binance: '15m', label: '15分钟', max: 600 },
  '30m': { binance: '30m', label: '30分钟', max: 600 },
  '1h':  { binance: '1h',  label: '1小时',  max: 600 },
  '4h':  { binance: '4h',  label: '4小时',  max: 600 },
  '1d':  { binance: '1d',  label: '1天',    max: 600 },
};

// 内存缓存
const klineCache = {};
export function getKlineCache(symbol, interval, limit) {
  const key = `${symbol}_${interval}`;
  return klineCache[key] || [];
}
export function upsertKline(k) {
  const key = `${k.symbol}_${k.interval}`;
  if (!klineCache[key]) klineCache[key] = [];
  const arr = klineCache[key];
  const existIdx = arr.findIndex(x => x.open_time === k.open_time);
  if (existIdx >= 0) arr[existIdx] = k;
  else { arr.push(k); arr.sort((a, b) => a.open_time - b.open_time); }
  // 保留条数
  if (arr.length > 500) klineCache[key] = arr.slice(-500);
}

export async function fetchKlines(interval = '5m', limit = 200) {
  const cached = getKlineCache(SYMBOL, interval, limit);
  if (cached && cached.length >= 30) return cached.slice(-limit);
  try {
    const resp = await axios.get(`${BINANCE_BASE()}/api/v3/klines`, {
      params: { symbol: SYMBOL, interval, limit },
      timeout: 15000,
    });
    const klines = resp.data.map(k => ({
      open_time: k[0], open: parseFloat(k[1]), high: parseFloat(k[2]),
      low: parseFloat(k[3]), close: parseFloat(k[4]), volume: parseFloat(k[5]), close_time: k[6],
    }));
    for (const k of klines) upsertKline({ symbol: SYMBOL, interval, ...k });
    return klines;
  } catch (err) {
    console.error('[Binance] fetchKlines error:', err.message);
    if (cached.length >= 30) return cached.slice(-limit);
    try {
      const resp2 = await axios.get(`${BINANCE_BASE()}/api/v3/klines`, {
        params: { symbol: SYMBOL, interval, limit },
        timeout: 12000,
      });
      return resp2.data.map(k => ({
        open_time: k[0], open: parseFloat(k[1]), high: parseFloat(k[2]),
        low: parseFloat(k[3]), close: parseFloat(k[4]), volume: parseFloat(k[5]), close_time: k[6],
      }));
    } catch { return cached.length >= 30 ? cached.slice(-limit) : []; }
  }
}

export async function fetchAllKlines(limit = 200) {
  const intervals = ['3m', '5m', '15m', '30m', '4h'];
  const results = {};
  await Promise.all(intervals.map(async (int) => { results[int] = await fetchKlines(int, limit); }));
  return results;
}

export async function getCurrentPrice() {
  try {
    const resp = await axios.get(`${BINANCE_BASE()}/api/v3/ticker/price`, {
      params: { symbol: SYMBOL },
      timeout: 8000,
    });
    const price = parseFloat(resp.data.price);
    lastPrices[SYMBOL] = price;
    return price;
  } catch (err) {
    const cached = lastPrices[SYMBOL];
    if (cached) return cached;
    try {
      const resp2 = await axios.get(`${BINANCE_BASE()}/api/v3/ticker/24hr`, {
        params: { symbol: SYMBOL },
        timeout: 8000,
      });
      const price = parseFloat(resp2.data.lastPrice);
      lastPrices[SYMBOL] = price;
      return price;
    } catch { return cached || 0; }
  }
}

export async function getOrderBook(limit = 10) {
  try {
    const resp = await axios.get(`${BINANCE_BASE()}/api/v3/depth`, {
      params: { symbol: SYMBOL, limit },
      timeout: 5000,
    });
    return {
      bids: resp.data.bids.map(([price, qty]) => ({ price: parseFloat(price), qty: parseFloat(qty) })),
      asks: resp.data.asks.map(([price, qty]) => ({ price: parseFloat(price), qty: parseFloat(qty) })),
    };
  } catch { return { bids: [], asks: [] }; }
}
