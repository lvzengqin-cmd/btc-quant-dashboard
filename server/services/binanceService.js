// ============================================================
//  多交易所市场数据服务
//  数据源优先级：BingX (主) → Binance (备用) → 所有节点轮询
// ============================================================

import axios from 'axios';

const SYMBOL = 'BTCUSDT';

// --- 数据源配置 ---
const BINGX_URL = 'https://open-api.bingx.com/openApi/spot/v1/ticker';
const BINANCE_BASES = [
  'https://api.binance.com',
  'https://api-gcp.binance.com',
  'api1.binance.com',
  'https://api2.binance.com',
  'https://api3.binance.com',
  'https://api4.binance.com',
];
let currentBaseIndex = 0;
const BINANCE_BASE = () => BINANCE_BASES[currentBaseIndex % BINANCE_BASES.length];
function nextBase() { currentBaseIndex++; }

// --- 状态 ---
let lastPrices = {};
let wsConnection = null;
let httpPollingTimer = null;
const POLL_INTERVAL_MS = 5000;

// ============================================================
//  数据获取核心
// ============================================================

async function fetchPrice() {
  // 1. BingX (主数据源，大多数地区可用)
  try {
    const resp = await axios.get(BINGX_URL, {
      params: { symbol: 'BTC-USDT' },
      timeout: 6000,
    });
    const data = resp.data?.data;
    if (data?.lastPrice) {
      const price = parseFloat(data.lastPrice);
      const change24h = parseFloat(data.priceChangePercent) || 0;
      console.log(`[BingX] BTC价格: $${price} (24h: ${change24h > 0 ? '+' : ''}${change24h}%)`);
      return { price, change24h, high24h: parseFloat(data.highPrice)||price, low24h: parseFloat(data.lowPrice)||price, volume24h: parseFloat(data.volume)||0, open24h: parseFloat(data.openPrice)||price };
    }
  } catch (err) {
    console.warn(`[BingX] 失败: ${err.message}`);
  }

  // 2. Binance 所有节点轮询
  for (let i = 0; i < BINANCE_BASES.length; i++) {
    const base = BINANCE_BASE();
    try {
      const resp = await axios.get(`${base}/api/v3/ticker/24hr`, {
        params: { symbol: SYMBOL },
        timeout: 6000,
      });
      const d = resp.data;
      const price = parseFloat(d.lastPrice);
      console.log(`[Binance ${base.split('//')[1]}] BTC价格: $${price}`);
      return {
        price,
        change24h: parseFloat(d.priceChangePercent),
        high24h: parseFloat(d.highPrice),
        low24h: parseFloat(d.lowPrice),
        volume24h: parseFloat(d.volume),
        open24h: parseFloat(d.openPrice),
      };
    } catch (err) {
      const status = err.response?.status;
      const blocked = status === 451 || status === 403;
      if (blocked) {
        console.warn(`[Binance ${base.split('//')[1]}] HTTP ${status} — 切换节点`);
        nextBase();
      } else {
        console.warn(`[Binance ${base.split('//')[1]}] 错误: ${err.message}`);
      }
    }
  }

  // 3. 所有节点都挂 → 返回0（不卡死）
  console.error('[价格服务] 所有数据源均不可用');
  return { price: 0, change24h: 0, high24h: 0, low24h: 0, volume24h: 0, open24h: 0 };
}

// ============================================================
//  HTTP 轮询
// ============================================================

function startHTTPPolling(onUpdate) {
  if (httpPollingTimer) clearInterval(httpPollingTimer);

  const poll = async () => {
    const data = await fetchPrice();
    if (data && data.price > 0) {
      lastPrices[SYMBOL] = data.price;
      if (onUpdate) onUpdate(data);
    }
  };

  poll(); // 立即执行一次
  httpPollingTimer = setInterval(poll, POLL_INTERVAL_MS);
  console.log(`[市场数据] 已启动 ${POLL_INTERVAL_MS/1000}秒 轮询`);
}

// ============================================================
//  WebSocket（备用 Binance）
// ============================================================

const BINANCE_WS = 'wss://stream.binance.com:9443/ws/btcusdt@ticker';

export function startWebSocket(onPriceUpdate) {
  if (httpPollingTimer) { clearInterval(httpPollingTimer); httpPollingTimer = null; }
  if (wsConnection) { wsConnection.terminate(); wsConnection = null; }

  try {
    wsConnection = new WebSocket(BINANCE_WS);
    wsConnection.onopen = () => {
      console.log('[Binance WS] 已连接');
      if (httpPollingTimer) { clearInterval(httpPollingTimer); httpPollingTimer = null; }
    };
    wsConnection.onmessage = (event) => {
      try {
        const d = JSON.parse(event.data);
        if (d.s === SYMBOL) {
          const price = parseFloat(d.c);
          lastPrices[SYMBOL] = price;
          if (onPriceUpdate) onPriceUpdate({
            price,
            change24h: parseFloat(d.P),
            high24h: parseFloat(d.h),
            low24h: parseFloat(d.l),
            volume24h: parseFloat(d.v),
            open24h: parseFloat(d.o),
          });
        }
      } catch {}
    };
    wsConnection.onerror = () => {
      console.warn('[Binance WS] 连接异常，切换为HTTP轮询');
      startHTTPPolling(onPriceUpdate);
    };
    wsConnection.onclose = () => {
      if (!httpPollingTimer) startHTTPPolling(onPriceUpdate);
    };
  } catch {
    startHTTPPolling(onPriceUpdate);
  }
}

// ============================================================
//  导出
// ============================================================

export function getLastPrice() { return lastPrices[SYMBOL] || 0; }

export async function getCurrentPrice() {
  return (await fetchPrice()).price;
}

// K线数据（仅 Binance）
export async function getKlines(limit = 200) {
  for (let tries = 0; tries < BINANCE_BASES.length; tries++) {
    const base = BINANCE_BASE();
    try {
      const resp = await axios.get(`${base}/api/v3/klines`, {
        params: { symbol: SYMBOL, interval: '1h', limit },
        timeout: 8000,
      });
      return resp.data.map(k => ({
        openTime: k[0], open: parseFloat(k[1]), high: parseFloat(k[2]),
        low: parseFloat(k[3]), close: parseFloat(k[4]), volume: parseFloat(k[5]),
        closeTime: k[6],
      }));
    } catch { nextBase(); }
  }
  return [];
}

export { startHTTPPolling };
