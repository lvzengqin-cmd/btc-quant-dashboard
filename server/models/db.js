// ============================================================
//  数据库初始化 & 数据模型（@libsql/client 纯JS版本，无需编译）
// ============================================================

import { createClient } from '@libsql/client';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '../data');
const DB_PATH = path.join(dataDir, 'quant.db');

if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

// libsql 客户端（本地文件，纯 JS，无需编译）
const db = createClient({ url: 'file:' + DB_PATH });

// ============================================================
//  表结构
// ============================================================

async function initDB() {
  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS signals (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      signal_id    TEXT    UNIQUE NOT NULL,
      direction    TEXT    NOT NULL,
      entry_price  REAL    NOT NULL,
      entry_time  TEXT    NOT NULL,
      expire_time TEXT    NOT NULL,
      confidence  REAL    NOT NULL,
      regime      TEXT    NOT NULL,
      active      INTEGER DEFAULT 1,
      result      TEXT    DEFAULT NULL,
      settle_price REAL   DEFAULT NULL,
      settle_time TEXT    DEFAULT NULL,
      pnl         REAL   DEFAULT NULL,
      factors_used TEXT    DEFAULT '[]',
      created_at  TEXT    DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS daily_stats (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      date          TEXT    UNIQUE NOT NULL,
      total_signals INTEGER  DEFAULT 0,
      win_signals   INTEGER  DEFAULT 0,
      loss_signals  INTEGER  DEFAULT 0,
      long_signals  INTEGER  DEFAULT 0,
      short_signals INTEGER  DEFAULT 0,
      long_wins     INTEGER  DEFAULT 0,
      short_wins    INTEGER  DEFAULT 0,
      total_pnl     REAL     DEFAULT 0,
      win_rate      REAL     DEFAULT 0,
      updated_at    TEXT    DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS factor_performance (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      factor_name     TEXT    NOT NULL,
      regime          TEXT    NOT NULL,
      total_count    INTEGER  DEFAULT 0,
      win_count      INTEGER  DEFAULT 0,
      loss_count     INTEGER  DEFAULT 0,
      avg_win_rate   REAL     DEFAULT 0,
      avg_confidence REAL     DEFAULT 0,
      recent_win_rate REAL   DEFAULT 0,
      recent_count   INTEGER  DEFAULT 0,
      weight         REAL     DEFAULT 1.0,
      updated_at     TEXT    DEFAULT (datetime('now')),
      UNIQUE(factor_name, regime)
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS learning_logs (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      date         TEXT    NOT NULL,
      trade_id     TEXT,
      loss_reason  TEXT,
      action_taken TEXT,
      factors      TEXT,
      created_at   TEXT    DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS kline_cache (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol     TEXT    NOT NULL,
      interval   TEXT    NOT NULL,
      open_time  INTEGER  UNIQUE NOT NULL,
      open       REAL,
      high       REAL,
      low        REAL,
      close      REAL,
      volume     REAL,
      close_time INTEGER,
      fetched_at TEXT    DEFAULT (datetime('now'))
    );
  `);
}

// 初始化数据库（忽略错误因为表已存在）
initDB().catch(() => {});

// ============================================================
//  辅助函数
// ============================================================

export function uuid() {
  return 'sig_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

function toRows(result) {
  return result.rows ? result.rows : [];
}

// ============================================================
//  信号操作
// ============================================================

export function insertSignal(signal) {
  return db.execute({
    sql: `INSERT INTO signals (signal_id, direction, entry_price, entry_time, expire_time, confidence, regime, factors_used)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [signal.signal_id, signal.direction, signal.entry_price, signal.entry_time,
           signal.expire_time, signal.confidence, signal.regime, JSON.stringify(signal.factors_used || [])]
  });
}

export function settleSignal(signal_id, result, settle_price, settle_time, pnl) {
  return db.execute({
    sql: `UPDATE signals SET result = ?, settle_price = ?, settle_time = ?, pnl = ?, active = 0 WHERE signal_id = ?`,
    args: [result, settle_price, settle_time, pnl, signal_id]
  });
}

// ============================================================
//  每日统计
// ============================================================

export function updateDailyStat(date, direction, result) {
  const existing = toRows(db.execute({ sql: 'SELECT * FROM daily_stats WHERE date = ?', args: [date] }));
  if (!existing.length) {
    db.execute({ sql: `INSERT INTO daily_stats (date) VALUES (?)`, args: [date] });
  }
  const winInc = result === 'win' ? 1 : 0;
  const lossInc = result === 'loss' ? 1 : 0;
  const longInc = direction === 'long' ? 1 : 0;
  const shortInc = direction === 'short' ? 1 : 0;
  const longWinInc = direction === 'long' && result === 'win' ? 1 : 0;
  const shortWinInc = direction === 'short' && result === 'win' ? 1 : 0;

  return db.execute({
    sql: `UPDATE daily_stats SET
      total_signals = total_signals + 1,
      win_signals   = win_signals   + ?,
      loss_signals  = loss_signals  + ?,
      long_signals  = long_signals  + ?,
      short_signals = short_signals + ?,
      long_wins     = long_wins     + ?,
      short_wins    = short_wins    + ?,
      total_pnl     = total_pnl     + ?,
      win_rate      = CASE WHEN (total_signals + 1) > 0 THEN (win_signals + ?) * 1.0 / (total_signals + 1) ELSE 0 END,
      updated_at    = datetime('now')
    WHERE date = ?`,
    args: [winInc, lossInc, longInc, shortInc, longWinInc, shortWinInc, pnl || 0, winInc, date]
  });
}

// ============================================================
//  因子表现
// ============================================================

export function updateFactorPerformance(factorName, regime, isWin, confidence) {
  const winInc = isWin ? 1 : 0;
  const lossInc = isWin ? 0 : 1;

  const existing = toRows(db.execute({
    sql: 'SELECT * FROM factor_performance WHERE factor_name = ? AND regime = ?',
    args: [factorName, regime]
  }));

  if (!existing.length) {
    return db.execute({
      sql: `INSERT INTO factor_performance (factor_name, regime, total_count, win_count, loss_count, avg_confidence, recent_win_rate, recent_count)
            VALUES (?, ?, 1, ?, ?, ?, ?, 1)`,
      args: [factorName, regime, winInc, lossInc, confidence, isWin ? 1 : 0]
    });
  }

  const row = existing[0];
  const newTotal = row.total_count + 1;
  const newWinCount = row.win_count + winInc;
  const newRecentCount = Math.min(20, row.recent_count + 1);
  const newRecentWinRate = isWin
    ? (row.recent_win_rate * row.recent_count + 1) / newRecentCount
    : (row.recent_win_rate * row.recent_count) / newRecentCount;

  return db.execute({
    sql: `UPDATE factor_performance SET
      total_count     = total_count + 1,
      win_count       = win_count   + ?,
      loss_count      = loss_count  + ?,
      avg_confidence  = (avg_confidence * total_count + ?) * 1.0 / (total_count + 1),
      recent_count    = ?,
      recent_win_rate = ?,
      updated_at      = datetime('now')
    WHERE factor_name = ? AND regime = ?`,
    args: [winInc, lossInc, confidence, newRecentCount, newRecentWinRate, factorName, regime]
  });
}

export function adjustFactorWeightsForLoss(tradeFactors, regime) {
  const updates = [];
  for (const factorName of tradeFactors) {
    const rows = toRows(db.execute({
      sql: 'SELECT * FROM factor_performance WHERE factor_name = ? AND regime = ?',
      args: [factorName, regime]
    }));
    if (!rows.length) continue;
    const row = rows[0];
    if (row.total_count >= 3) {
      const winRate = row.win_count / row.total_count;
      if (winRate < 0.4) {
        const newWeight = Math.max(0.1, row.weight * 0.8);
        db.execute({ sql: 'UPDATE factor_performance SET weight = ? WHERE factor_name = ? AND regime = ?',
          args: [newWeight, factorName, regime] });
        updates.push({ factor: factorName, oldWeight: row.weight, newWeight, reason: 'loss_rate_too_low' });
      }
    }
  }
  return updates;
}

export function logLearning(date, tradeId, lossReason, actionTaken, factors) {
  return db.execute({
    sql: 'INSERT INTO learning_logs (date, trade_id, loss_reason, action_taken, factors) VALUES (?, ?, ?, ?, ?)',
    args: [date, tradeId, lossReason, actionTaken, JSON.stringify(factors || [])]
  });
}

// ============================================================
//  设置读写
// ============================================================

const DEFAULT_SETTINGS = {
  confidence_threshold: '70',
  auto_check_enabled: 'true',
  webhook_long_url: '',
  webhook_short_url: '',
  check_interval_minutes: '5'
};

export function getSetting(key, defaultValue = null) {
  const rows = toRows(db.execute({ sql: 'SELECT value FROM settings WHERE key = ?', args: [key] }));
  if (rows.length && rows[0].value !== null) return rows[0].value;
  return DEFAULT_SETTINGS[key] ?? defaultValue;
}

export function getAllSettings() {
  const rows = toRows(db.execute('SELECT key, value FROM settings'));
  const settings = { ...DEFAULT_SETTINGS };
  for (const r of rows) settings[r.key] = r.value;
  return settings;
}

export function setSetting(key, value) {
  return db.execute({
    sql: 'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
    args: [key, String(value)]
  });
}

// ============================================================
//  查询接口
// ============================================================

export function getActiveSignals() {
  return toRows(db.execute('SELECT * FROM signals WHERE active = 1 ORDER BY created_at DESC'));
}

export function getSignalHistory(limit = 100) {
  return toRows(db.execute({ sql: 'SELECT * FROM signals ORDER BY created_at DESC LIMIT ?', args: [limit] }));
}

export function getDailyStats(days = 30) {
  return toRows(db.execute({ sql: 'SELECT * FROM daily_stats ORDER BY date DESC LIMIT ?', args: [days] }));
}

export function getTotalStats() {
  const rows = toRows(db.execute(`
    SELECT
      COUNT(*) as total,
      COALESCE(SUM(CASE WHEN result = 'win' THEN 1 ELSE 0 END), 0) as wins,
      COALESCE(SUM(CASE WHEN result = 'loss' THEN 1 ELSE 0 END), 0) as losses,
      COALESCE(SUM(pnl), 0) as total_pnl
    FROM signals WHERE result IS NOT NULL
  `));
  const row = rows[0] || { total: 0, wins: 0, losses: 0, total_pnl: 0 };
  return { ...row, winRate: row.total > 0 ? row.wins / row.total : 0 };
}

export function getFactorPerformance(regime = null) {
  if (regime) {
    return toRows(db.execute({ sql: 'SELECT * FROM factor_performance WHERE regime = ? ORDER BY recent_win_rate DESC', args: [regime] }));
  }
  return toRows(db.execute('SELECT * FROM factor_performance ORDER BY recent_win_rate DESC'));
}

export function upsertKline(kline) {
  return db.execute({
    sql: `INSERT OR REPLACE INTO kline_cache (symbol, interval, open_time, open, high, low, close, volume, close_time)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [kline.symbol, kline.interval, kline.open_time,
           kline.open, kline.high, kline.low, kline.close, kline.volume, kline.close_time]
  });
}

export function getKlineCache(symbol, interval, count = 200) {
  const rows = toRows(db.execute({
    sql: 'SELECT * FROM kline_cache WHERE symbol = ? AND interval = ? ORDER BY open_time DESC LIMIT ?',
    args: [symbol, interval, count]
  }));
  return rows.reverse();
}

export function getRecentLossTrades(days = 7, limit = 20) {
  return toRows(db.execute({
    sql: `SELECT s.* FROM signals s
          WHERE s.result = 'loss'
          AND s.created_at >= datetime('now', '-${days} days')
          ORDER BY s.created_at DESC LIMIT ?`,
    args: [limit]
  }));
}

export function getLearningInsights(days = 30) {
  const stats = getTotalStats();
  const strongFactors = getFactorPerformance().filter(f => f.recent_win_rate >= 0.55 && f.total_count >= 3);
  const weakFactors = getFactorPerformance().filter(f => f.recent_win_rate < 0.45 && f.total_count >= 3);
  const lossTrades = getRecentLossTrades(days);
  const recentLogs = toRows(db.execute({
    sql: `SELECT date, loss_reason, action_taken FROM learning_logs ORDER BY created_at DESC LIMIT 20`
  }));

  return {
    totalSignals: stats.total,
    winRate: stats.winRate,
    strongFactors,
    weakFactors,
    recentLogs,
    totalLosses: lossTrades.length,
  };
}

export { db };
