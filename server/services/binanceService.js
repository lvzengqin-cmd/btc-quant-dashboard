// ============================================================
//  多交易所市场数据服务
//  数据源优先级：Gate.io (主) → Binance (备用) → BingX
//  Gate.io 在中国大陆可访问！
// ============================================================

import axios from 'axios';

const SYMBOL = 'BTCUSDT';
const SYMBOL_GATE = 'BTC_USDT';

// --- 数据源配置 ---
const GATEIO_URL = 'https://api.gateio.ws/api/v4/spot/tickers';

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
function nextBase() { currentBaseIndex++; }

// BingX (备用)
const BINGX_URL = 'https://open-api.bingx.com/openApi/spot/v1/ticker';

// --- 状态 ---
let lastPrices = {};
let wsConnection = null;
let httpPollingTimer = null;
const POLL_INTERVAL_MS = 5000;

// ============================================================
//  数据获取核心
// ============================================================

async function fetchPrice() {
  // 1. Gate.io (主数据源，中国大陆可访问)
  try {
    const resp = await axios.get(GATEIO_URL, {
      params: { currency_pair: SYMBOL_GATE },
      timeout: 6000,
      headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' }
    });
    const data = resp.data?.[0];
    if (data?.last) {
      const price = parseFloat(data.last);
      const change24h = parseFloat(data.change) || 0;
      const volume = parseFloat(data.volume) || 0;
      console.log(`[Gate.io] BTC价格: $${price} (24h: ${change24h > 0 ? '+' : ''}${change24h}%)`);
      return {
        price,
        change24h,
        high24h: parseFloat(data.high) || price,
        low24h: parseFloat(data.low) || price,
        volume24h: volume,
        open24h: parseFloat(data.open) || price,
      };
    }
  } catch (err) {
    console.warn(`[Gate.io] 失败: ${err.message}`);
  }

  // 2. Binance 所有节点轮询（备用）
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
      if (status === 451 || status === 403) {
        console.warn(`[Binance ${base.split('//')[1]}] HTTP ${status} — 切换节点`);
        nextBase();
      } else {
        console.warn(`[Binance] ${base.split('//')[1]}: ${err.message}`);
      }
    }
  }

  // 3. BingX (最后备用)
  try {
    const resp = await axios.get(BINGX_URL, {
      params: { symbol: 'BTC-USDT' },
      timeout: 6000,
    });
    const data = resp.data?.data;
    if (data?.lastPrice) {
      const price = parseFloat(data.lastPrice);
      console.log(`[BingX] BTC价格: $${price}`);
      return { price, change24h: parseFloat(data.priceChangePercent)||0, high24h: parseFloat(data.highPrice)||price, low24h: parseFloat(data.lowPrice)||price, volume24h: parseFloat(data.volume)||0, open24h: parseFloat(data.openPrice)||price };
    }
  } catch (err) {
    console.warn(`[BingX] 失败: ${err.message}`);
  }

  // 所有都挂了
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

  poll();
  httpPollingTimer = setInterval(poll, POLL_INTERVAL_MS);
  console.log(`[市场数据] 已启动 ${POLL_INTERVAL_MS/1000}秒 轮询`);
}

// ============================================================
//  WebSocket（Binance）
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
      console.warn('[Binance WS] 连接异常，切换HTTP轮询');
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

export const getKlines = fetchAllKlines;

// Gate.io K线
export async function fetchAllKlines(limit = 200) {
  // 先尝试 Gate.io K线
  try {
    const resp = await axios.get('https://api.gateio.ws/api/v4/spot/candlesticks', {
      params: { currency_pair: SYMBOL_GATE, interval: '1h', limit },
      timeout: 8000,
    });
    if (Array.isArray(resp.data)) {
      return resp.data.map(k => ({
        openTime: k[0], open: parseFloat(k[5]), high: parseFloat(k[3]),
        low: parseFloat(k[4]), close: parseFloat(k[2]), volume: parseFloat(k[6]),
        closeTime: k[0] + 3600000,
      }));
    }
  } catch {}
  return [];
}

export { startHTTPPolling };
