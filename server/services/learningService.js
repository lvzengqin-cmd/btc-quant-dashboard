// 自学习服务 - 亏损复盘 + 因子权重动态调整
import { db } from '../models/db.js';

export function analyzeLossTrade(trade) {
  // 分析亏损原因
  const reasons = [];
  if (trade.factors && Array.isArray(trade.factors)) {
    trade.factors.forEach(factor => {
      const fp = db.prepare('SELECT * FROM factor_performance WHERE factor_name = ? AND regime = ?').get(factor, trade.regime);
      if (fp) {
        const winRate = fp.win_count / (fp.total_count || 1);
        if (winRate < 0.4) reasons.push({ factor, winRate, issue: 'win_rate_too_low' });
        else if (winRate < 0.5) reasons.push({ factor, winRate, issue: 'below_50_percent' });
      }
    });
  }
  return reasons;
}

export function adjustFactorWeightsForLoss(tradeFactors, regime) {
  const adjustments = [];
  for (const factorName of tradeFactors) {
    const row = db.prepare('SELECT * FROM factor_performance WHERE factor_name = ? AND regime = ?').get(factorName, regime);
    if (row && row.total_count >= 3) {
      const winRate = row.win_count / row.total_count;
      if (winRate < 0.4) {
        const newWeight = Math.max(0.1, row.weight * 0.8);
        db.prepare('UPDATE factor_performance SET weight = ? WHERE factor_name = ? AND regime = ?').run(newWeight, factorName, regime);
        adjustments.push({ factor: factorName, oldWeight: row.weight, newWeight: newWeight.toFixed(3), reason: 'win_rate_below_40pct' });
      }
    }
  }
  return adjustments;
}

export function logLearning(date, tradeId, lossReason, actionTaken, factors) {
  db.prepare(`INSERT INTO learning_logs (date, trade_id, loss_reason, action_taken, factors) VALUES (?, ?, ?, ?, ?)`)
    .run(date, tradeId || '', lossReason, actionTaken, JSON.stringify(factors));
}

export function getLearningInsights(days = 7) {
  const trades = db.prepare(`SELECT * FROM signals WHERE result = 'loss' AND created_at >= datetime('now','-${days} days')`).all();
  const factorStats = db.prepare(`SELECT * FROM factor_performance ORDER BY recent_win_rate ASC LIMIT 10`).all();
  const learningLogs = db.prepare(`SELECT * FROM learning_logs ORDER BY created_at DESC LIMIT 20`).all();
  const allFactors = db.prepare(`SELECT * FROM factor_performance ORDER BY total_count DESC`).all();
  // 分析亏损因子模式
  const weakFactors = allFactors.filter(f => f.total_count >= 3 && f.win_count / f.total_count < 0.45);
  const strongFactors = allFactors.filter(f => f.total_count >= 5 && f.win_count / f.total_count > 0.6);
  return {
    totalLosses: trades.length,
    weakFactors,
    strongFactors,
    recentLogs: learningLogs,
    insights: generateInsights(weakFactors, strongFactors)
  };
}

function generateInsights(weak, strong) {
  const insights = [];
  if (weak.length > 0) {
    insights.push(`⚠️ 近期胜率低于45%的因子: ${weak.map(f=>f.factor_name).join(', ')}，已自动降低权重`);
  }
  if (strong.length > 0) {
    insights.push(`✅ 表现优秀的因子: ${strong.map(f=>f.factor_name).join(', ')}，将保持较高权重`);
  }
  if (insights.length === 0) insights.push('📊 因子表现整体良好，未检测到明显失效因子');
  return insights;
}
