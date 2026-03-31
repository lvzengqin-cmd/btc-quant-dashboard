// ============================================================
//  数据库初始化 & 数据模型
// ============================================================

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '../data/quant.db');

// 确保 data 目录存在
import fs from 'fs';
const dataDir = path.join(__dirname, '../data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(DB_PATH);

// 启用 WAL 模式提高并发性能
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ============================================================
//  表结构
// ============================================================

db.exec(`
  -- 信号记录表
  CREATE TABLE IF NOT EXISTS signals (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    signal_id        TEXT    UNIQUE NOT NULL,   -- 唯一标识 UUID
    direction        TEXT    NOT NULL,           -- 'long' | 'short'
    entry_price      REAL    NOT NULL,           -- 开仓价格
    entry_time       TEXT    NOT NULL,           -- ISO 时间
    expire_time      TEXT    NOT NULL,           -- 结算时间 (entry_time + 30min)
    confidence       REAL    NOT NULL,           -- 置信度 0~100
    regime           TEXT    NOT NULL,           -- 'trend'|'mean_reversion'|'momentum'|'volatility'|'mixed'
    active          INTEGER  DEFAULT 1,          -- 是否活跃（结算前=1）
    result          TEXT    DEFAULT NULL,        -- 'win' | 'loss' | NULL
    settle_price    REAL    DEFAULT NULL,        -- 结算价格
    settle_time     TEXT    DEFAULT NULL,        -- 结算时间
    pnl             REAL    DEFAULT NULL,        -- 盈亏金额（相对值）
    factors_used    TEXT    DEFAULT '[]',        -- 使用的因子 JSON
    created_at      TEXT    DEFAULT (datetime('now'))
  );

  -- 每日统计表
  CREATE TABLE IF NOT EXISTS daily_stats (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    date            TEXT    UNIQUE NOT NULL,    -- YYYY-MM-DD
    total_signals   INTEGER  DEFAULT 0,
    win_signals     INTEGER  DEFAULT 0,
    loss_signals    INTEGER  DEFAULT 0,
    long_signals    INTEGER  DEFAULT 0,
    short_signals   INTEGER  DEFAULT 0,
    long_wins       INTEGER  DEFAULT 0,
    short_wins      INTEGER  DEFAULT 0,
    total_pnl       REAL     DEFAULT 0,
    win_rate        REAL     DEFAULT 0,
    updated_at      TEXT    DEFAULT (datetime('now'))
  );

  -- 因子有效性表（自学习核心）
  CREATE TABLE IF NOT EXISTS factor_performance (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    factor_name      TEXT    NOT NULL,
    regime           TEXT    NOT NULL,           -- 'trend'|'mean_reversion'|'momentum'|'volatility'|'mixed'
    total_count      INTEGER  DEFAULT 0,         -- 使用次数
    win_count        INTEGER  DEFAULT 0,         -- 盈利次数
    loss_count       INTEGER  DEFAULT 0,         -- 亏损次数
    avg_win_rate     REAL     DEFAULT 0,         -- 平均胜率
    avg_confidence   REAL     DEFAULT 0,         -- 平均置信度
    recent_win_rate  REAL     DEFAULT 0,         -- 最近20次胜率
    recent_count     INTEGER  DEFAULT 0,         -- 最近计数
    weight           REAL     DEFAULT 1.0,       -- 动态权重（自学习调整）
    updated_at      TEXT    DEFAULT (datetime('now'))
  );

  -- 系统设置表
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
  );

  -- 学习日志表
  CREATE TABLE IF NOT EXISTS learning_logs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    date        TEXT    NOT NULL,
    trade_id    TEXT,
    loss_reason TEXT,
    action_taken TEXT,
    factors     TEXT,
    created_at  TEXT    DEFAULT (datetime('now'))
  );

  -- K线缓存表（避免频繁请求币安）
  CREATE TABLE IF NOT EXISTS kline_cache (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol       TEXT    NOT NULL,
    interval     TEXT    NOT NULL,
    open_time    INTEGER  UNIQUE NOT NULL,
    open         REAL,
    high         REAL,
    low          REAL,
    close        REAL,
    volume       REAL,
    close_time   INTEGER,
    fetched_at   TEXT    DEFAULT (datetime('now'))
  );
`);

// ============================================================
//  辅助函数
// ============================================================

export function uuid() {
  return 'sig_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

/**
 * 记录一条信号
 */
export function insertSignal(signal) {
  const stmt = db.prepare(`
    INSERT INTO signals (signal_id, direction, entry_price, entry_time, expire_time,
                         confidence, regime, factors_used)
    VALUES (@signal_id, @direction, @entry_price, @entry_time, @expire_time,
            @confidence, @regime, @factors_used)
  `);
  return stmt.run(signal);
}

/**
 * 结算信号
 */
export function settleSignal(signal_id, result, settle_price, settle_time, pnl) {
  const stmt = db.prepare(`
    UPDATE signals
    SET result = @result, settle_price = @settle_price, settle_time = @settle_time,
        pnl = @pnl, active = 0
    WHERE signal_id = @signal_id
  `);
  return stmt.run({ signal_id, result, settle_price, settle_time, pnl });
}

/**
 * 更新每日统计
 */
export function updateDailyStat(date, direction, result) {
  const existing = db.prepare('SELECT * FROM daily_stats WHERE date = ?').get(date);
  if (!existing) {
    db.prepare(`
      INSERT INTO daily_stats (date, total_signals, win_signals, loss_signals,
                               long_signals, short_signals, long_wins, short_wins, total_pnl, win_rate)
      VALUES (?, 0, 0, 0, 0, 0, 0, 0, 0, 0)
    `).run(date);
  }

  const increment = db.prepare(`
    UPDATE daily_stats
    SET total_signals = total_signals + 1,
        win_signals   = win_signals   + @win_inc,
        loss_signals  = loss_signals  + @loss_inc,
        long_signals  = long_signals  + @long_inc,
        short_signals = short_signals + @short_inc,
        long_wins     = long_wins     + @long_win_inc,
        short_wins    = short_wins    + @short_win_inc,
        total_pnl     = total_pnl     + @pnl,
        win_rate      = CASE WHEN total_signals + 1 > 0
                             THEN (win_signals + @win_inc) * 1.0 / (total_signals + 1)
                             ELSE 0 END,
        updated_at    = datetime('now')
    WHERE date = ?
  `);

  increment.run({
    win_inc: result === 'win' ? 1 : 0,
    loss_inc: result === 'loss' ? 1 : 0,
    long_inc: direction === 'long' ? 1 : 0,
    short_inc: direction === 'short' ? 1 : 0,
    long_win_inc: direction === 'long' && result === 'win' ? 1 : 0,
    short_win_inc: direction === 'short' && result === 'win' ? 1 : 0,
    pnl: pnl || 0,
    date
  });
}

/**
 * 更新因子表现（自学习核心）
 */
export function updateFactorPerformance(factorName, regime, isWin, confidence) {
  const stmt = db.prepare(`
    INSERT INTO factor_performance (factor_name, regime, total_count, win_count, loss_count, avg_confidence, weight)
    VALUES (?, ?, 1, ?, ?, ?, 1.0)
    ON CONFLICT(factor_name, regime) DO UPDATE SET
      total_count  = total_count  + 1,
      win_count    = win_count    + @win_inc,
      loss_count   = loss_count   + @loss_inc,
      avg_confidence = (avg_confidence * total_count + @confidence) * 1.0 / (total_count + 1),
      recent_count = CASE WHEN recent_count >= 20 THEN 20 ELSE recent_count + 1 END,
      recent_win_rate = CASE
        WHEN recent_count >= 20
        THEN (recent_win_rate * 20 - CASE WHEN previous_win THEN 1 ELSE 0 END + @win_inc) * 1.0 / 20
        ELSE ((recent_win_rate * (recent_count - 1)) + @win_inc) * 1.0 / recent_count
      END,
      updated_at = datetime('now')
  `);

  // 获取上次是否盈利（用于计算滑动窗口）
  const prev = db.prepare('SELECT win_count FROM factor_performance WHERE factor_name = ? AND regime = ?')
    .get(factorName, regime);
  const prevWin = prev ? (prev.win_count / (prev.total_count || 1)) > 0.5 : false;

  stmt.run({
    win_inc: isWin ? 1 : 0,
    loss_inc: isWin ? 0 : 1,
    confidence,
    previous_win: prevWin ? 1 : 0
  });
}

/**
 * 基于亏损交易调整因子权重（自学习）
 */
export function adjustFactorWeightsForLoss(tradeFactors, regime) {
  const updates = [];
  for (const factorName of tradeFactors) {
    const row = db.prepare('SELECT * FROM factor_performance WHERE factor_name = ? AND regime = ?')
      .get(factorName, regime);
    if (row && row.total_count >= 3) {
      // 如果某个因子的胜率 < 40%，降低其权重
      const winRate = row.win_count / row.total_count;
      if (winRate < 0.4) {
        const newWeight = Math.max(0.1, row.weight * 0.8); // 权重降低 20%，最低 0.1
        db.prepare('UPDATE factor_performance SET weight = ? WHERE factor_name = ? AND regime = ?')
          .run(newWeight, factorName, regime);
        updates.push({ factor: factorName, oldWeight: row.weight, newWeight, reason: 'loss_rate_too_low' });
      }
    }
  }
  return updates;
}

/**
 * 记录学习日志
 */
export function logLearning(date, tradeId, lossReason, actionTaken, factors) {
  db.prepare(`
    INSERT INTO learning_logs (date, trade_id, loss_reason, action_taken, factors)
    VALUES (?, ?, ?, ?, ?)
  `).run(date, tradeId, lossReason, actionTaken, JSON.stringify(factors));
}

/**
 * 获取设置
 */
const DEFAULT_SETTINGS = {
  confidence_threshold: '70',
  auto_check_enabled: 'true',
  webhook_long_url: '',
  webhook_short_url: ''
};

export function getSetting(key, defaultValue = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (row && row.value !== null) return row.value;
  return DEFAULT_SETTINGS[key] ?? defaultValue;
}

/**
 * 保存设置
 */
export function setSetting(key, value) {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, String(value));
}

/**
 * 获取活跃信号
 */
export function getActiveSignals() {
  return db.prepare('SELECT * FROM signals WHERE active = 1 ORDER BY created_at DESC').all();
}

/**
 * 获取信号历史
 */
export function getSignalHistory(limit = 100) {
  return db.prepare('SELECT * FROM signals ORDER BY created_at DESC LIMIT ?').all(limit);
}

/**
 * 获取每日统计
 */
export function getDailyStats(days = 30) {
  return db.prepare(`
    SELECT * FROM daily_stats
    ORDER BY date DESC LIMIT ?
  `).all(days);
}

/**
 * 获取总统计
 */
export function getTotalStats() {
  const row = db.prepare(`
    SELECT
      COUNT(*) as total,
      COALESCE(SUM(CASE WHEN result = 'win' THEN 1 ELSE 0 END), 0) as wins,
      COALESCE(SUM(CASE WHEN result = 'loss' THEN 1 ELSE 0 END), 0) as losses,
      COALESCE(SUM(pnl), 0) as total_pnl
    FROM signals WHERE result IS NOT NULL
  `).get();

  const winRate = row.total > 0 ? row.wins / row.total : 0;
  return { ...row, winRate };
}

/**
 * 获取因子有效性排名
 */
export function getFactorPerformance(regime = null) {
  if (regime) {
    return db.prepare(`
      SELECT * FROM factor_performance WHERE regime = ?
      ORDER BY recent_win_rate DESC
    `).all(regime);
  }
  return db.prepare('SELECT * FROM factor_performance ORDER BY recent_win_rate DESC').all();
}

/**
 * 保存K线缓存
 */
export function upsertKline(kline) {
  db.prepare(`
    INSERT OR REPLACE INTO kline_cache
    (symbol, interval, open_time, open, high, low, close, volume, close_time)
    VALUES (@symbol, @interval, @open_time, @open, @high, @low, @close, @volume, @close_time)
  `).run(kline);
}

/**
 * 获取K线缓存
 */
export function getKlineCache(symbol, interval, count = 200) {
  return db.prepare(`
    SELECT * FROM kline_cache
    WHERE symbol = ? AND interval = ?
    ORDER BY open_time DESC LIMIT ?
  `).all(symbol, interval, count).reverse();
}

/**
 * 获取近期亏损交易（用于复盘）
 */
export function getRecentLossTrades(days = 7, limit = 20) {
  return db.prepare(`
    SELECT s.*, f.factor_name, f.win_count, f.total_count, f.weight, f.regime
    FROM signals s
    LEFT JOIN json_each(s.factors) AS j
    LEFT JOIN factor_performance f ON f.factor_name = j.value AND f.regime = s.regime
    WHERE s.result = 'loss'
      AND s.created_at >= datetime('now', '-' || ? || ' days')
    ORDER BY s.created_at DESC LIMIT ?
  `).all(days, limit);
}

export { db };
