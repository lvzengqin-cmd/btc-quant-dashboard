import { useState, useEffect, useCallback } from 'react';
import './App.css';
// 多地址自动重试 — 隧道断了自动切换
const API_PRIMARY = (import.meta as any).env?.VITE_API_URL || '';
const API_FALLBACKS = [
  'https://vegpttffq746.space.minimaxi.com',
];
async function smartFetch(path: string, opts?: RequestInit) {
  const urls = [API_PRIMARY, ...API_FALLBACKS].filter(Boolean);
  for (const base of urls) {
    try {
      const r = await fetch(base + path, opts);
      if (r.ok || r.status < 500) return r;
    } catch { /* try next */ }
  }
  return { ok: false, json: async () => null } as Response;
}
const API = ''; // deprecated — use smartFetch()
const fmt = (p: number) => p ? '$' + p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';
const fmtT = (t: string) => new Date(t).toLocaleString('zh-CN', { hour12: false });
const fmtP = (p: number) => p ? (p >= 0 ? '+' : '') + (p * 100).toFixed(2) + '%' : '—';
const wrC = (r: number) => r > 0.55 ? '#00C853' : r > 0.45 ? '#D4A017' : '#E53935';
const ss = (s: number) => (s > 0 ? '+' : '') + s.toFixed(0);
const R: Record<string, { l: string; e: string; c: string }> = { trend: { l: '趋势', e: '📈', c: '#00C853' }, mean_reversion: { l: '均值回归', e: '📉', c: '#D4A017' }, momentum: { l: '动量', e: '⚡', c: '#4A90E2' }, volatility: { l: '高波动', e: '🌊', c: '#E53935' }, mixed: { l: '混合', e: '⚖️', c: '#7A9ABE' } };
const RegimeTag = (p: { r: string }) => { const m = R[p.r] || R.mixed; return <span style={{ color: m.c, fontWeight: 700 }}>{m.e}{m.l}</span>; };
const FCATS: Record<string, { l: string; c: string }> = { trend: { l: '📈 趋势', c: '#00C853' }, mean_reversion: { l: '📉 均值回归', c: '#D4A017' }, momentum: { l: '⚡ 动量', c: '#4A90E2' }, volatility: { l: '🌊 波动性', c: '#E53935' } };
const ALL = [
  { n: 'TREND_MA_GOLDEN', c: 'trend', d: '均线黄金叉' }, { n: 'TREND_SUPERTREND', c: 'trend', d: '超级趋势线' }, { n: 'TREND_ADX_STRONG', c: 'trend', d: 'ADX趋势强度' }, { n: 'REGIME_TREND_PERSISTENCE', c: 'trend', d: '均线多头/空头排列' },
  { n: 'REVERSION_RSI_OVERSOLD', c: 'mean_reversion', d: 'RSI超卖' }, { n: 'REVERSION_RSI_OVERBOUGHT', c: 'mean_reversion', d: 'RSI超买' }, { n: 'REVERSION_BOLL_LOWER', c: 'mean_reversion', d: '布林下轨反弹' }, { n: 'REVERSION_BOLL_UPPER', c: 'mean_reversion', d: '布林上轨反转' }, { n: 'REVERSION_KDJ_OVERSOLD', c: 'mean_reversion', d: 'KDJ超卖金叉' }, { n: 'REVERSION_KDJ_OVERBOUGHT', c: 'mean_reversion', d: 'KDJ超买死叉' },
  { n: 'MOMENTUM_RSI_DIVERGENCE_BULL', c: 'momentum', d: 'RSI底背离' }, { n: 'MOMENTUM_RSI_DIVERGENCE_BEAR', c: 'momentum', d: 'RSI顶背离' }, { n: 'MOMENTUM_MACD_GOLDEN', c: 'momentum', d: 'MACD零轴上金叉' }, { n: 'MOMENTUM_MACD_DEATH', c: 'momentum', d: 'MACD零轴下死叉' }, { n: 'MOMENTUM_VOLUME_SPIKE', c: 'momentum', d: '成交量突增' }, { n: 'MOMENTUM_MFI_EXTREME', c: 'momentum', d: 'MFI资金流量极值' },
  { n: 'VOLATILITY_BOLL_SQUEEZE', c: 'volatility', d: '布林带收口爆发' }, { n: 'VOLATILITY_ATR_BREAK', c: 'volatility', d: 'ATR波动率爆发' }, { n: 'VOLATILITY_WILLIAMS_R', c: 'volatility', d: '威廉指标极值' }, { n: 'REGIME_SIDEWAYS', c: 'mean_reversion', d: '横盘震荡识别' }, { n: 'TIMING_CCI_OVERSOLD', c: 'momentum', d: 'CCI超卖' },
];
export default function App() {
  const [tab, setTab] = useState<'dashboard' | 'history' | 'stats' | 'learning' | 'settings'>('dashboard');
  const [tick, setTick] = useState<{ price: number; change24h: number } | null>(null);
  const [sigs, setSigs] = useState<any[]>([]);
  const [actSigs, setActSigs] = useState<any[]>([]);
  const [tot, setTot] = useState({ total: 0, wins: 0, losses: 0, total_pnl: 0, winRate: 0 });
  const [daily, setDaily] = useState<any[]>([]);
  const [learn, setLearn] = useState<any>(null);
  const [score, setScore] = useState<any>(null);
  const [showFp, setShowFp] = useState(false);
  const [showLib, setShowLib] = useState(false);
  const [wsOn, setWsOn] = useState(false);
  const [lastChk, setLastChk] = useState('');
  const [loading, setLoading] = useState(false);
  const [sets, setSets] = useState({ webhook_long_url: '', webhook_short_url: '', confidence_threshold: '70', check_interval_minutes: '5' });
  const [draft, setDraft] = useState({ ...sets });
  const [timeR, setTimeR] = useState<'today' | '15d' | '30d'>('15d');
  const ref = useCallback(async () => {
    const dm: Record<string, number> = { today: 1, '15d': 15, '30d': 30 };
    const days = dm[timeR] || 15;
    try {
      const [a, b, c, d, e] = await Promise.all([
        fetch(API + '/api/signals/history?limit=50').then(r => r.json()).catch(() => []),
        fetch(API + '/api/signals/active').then(r => r.json()).catch(() => []),
        fetch(API + '/api/stats/total').then(r => r.json()).catch(() => ({ total: 0, wins: 0, losses: 0, total_pnl: 0, winRate: 0 })),
        fetch(API + '/api/stats/daily?days=' + days).then(r => r.json()).catch(() => []),
        fetch(API + '/api/stats/learning?days=' + days).then(r => r.json()).catch(() => null),
      ]);
      setSigs(a || []); setActSigs(b || []); setTot(c); setDaily(d || []); setLearn(e);
    } catch { /* silent */ }
  }, [API, timeR]);
  useEffect(() => {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    let ws: WebSocket;
    try {
      ws = new WebSocket(proto + '//' + window.location.host);
      ws.onopen = () => setWsOn(true);
      ws.onclose = () => setWsOn(false);
      ws.onmessage = (e) => {
        const d = JSON.parse(e.data);
        if (d.type === 'tick') setTick(d);
        if (d.type === 'signal') { const n: any = { ...d, signal_id: d.signalId }; setActSigs((p: any[]) => [n, ...(p || []).filter((x: any) => x.signal_id !== d.signalId)]); setLastChk(new Date().toLocaleTimeString('zh-CN', { hour12: false })); }
        if (d.type === 'signal_result') { setSigs((p: any[]) => (p || []).map((x: any) => x.signal_id === d.signalId ? { ...x, ...d } : x)); setActSigs((p: any[]) => (p || []).filter((x: any) => x.signal_id !== d.signalId)); ref(); }
      };
    } catch { setWsOn(false); }
    return () => { try { ws?.close(); } catch { /* noop */ } };
  }, [ref]);
  useEffect(() => { ref(); const t = setInterval(ref, 20000); return () => clearInterval(t); }, [ref]);
  useEffect(() => {
    fetch(API + '/api/settings').then(r => r.json()).then(s => { setSets(s); setDraft(s); }).catch(() => { /* silent */ });
    const t = setInterval(async () => { const r = await fetch(API + '/api/market/score').catch(() => null); if (r?.ok !== false) { const d = await r?.json().catch(() => null); if (d) setScore(d); } }, 30000);
    return () => clearInterval(t);
  }, [API]);
  const save = async () => { for (const [k, v] of Object.entries(draft)) { await fetch(API + '/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: k, value: v }) }).catch(() => { /* silent */ }); } setSets(draft); alert('设置已保存'); };
  const trigger = async () => { setLoading(true); await fetch(API + '/api/check', { method: 'POST' }).catch(() => { /* silent */ }); setTimeout(async () => { setLoading(false); await ref(); }, 4000); };
  const fl = (fu?: string) => { try { return JSON.parse(fu || '[]').slice(0, 3).join(', '); } catch { return '—'; } };
  const iR = score && score.indicators ? [
    { l: 'RSI(14)', v: score.indicators.rsi, c: score.indicators.rsi > 70 ? '#E53935' : score.indicators.rsi < 30 ? '#00C853' : '#4A90E2' },
    { l: 'ADX', v: score.indicators.adx, c: score.indicators.adx > 30 ? '#00C853' : '#D4A017' },
    { l: 'MACD', v: score.indicators.macd?.histogram >= 0 ? '▲ 多头' : '▼ 空头', c: score.indicators.macd?.histogram >= 0 ? '#00C853' : '#E53935' },
    { l: 'KDJ-K', v: score.indicators.kdj?.k?.toFixed(0), c: score.indicators.kdj?.k > 80 ? '#E53935' : score.indicators.kdj?.k < 20 ? '#00C853' : '#4A90E2' },
    { l: '布林上轨', v: score.indicators.boll?.upper?.toFixed(0), c: '#4A90E2' }, { l: '布林中轨', v: score.indicators.boll?.middle?.toFixed(0), c: '#D4A017' },
    { l: '布林下轨', v: score.indicators.boll?.lower?.toFixed(0), c: '#4A90E2' }, { l: '最新价', v: score.indicators.price?.toFixed(2), c: '#4A90E2' },
  ] : null;
  const activeSet = new Set((score?.activeFactors || []).map((f: any) => f.name));
  return (
    <div className="app">
      <header className="header">
        <div className="header-brand"><div className="header-logo">₿</div><div><div className="header-title">策奕事件合约AI量化系统</div><div className="header-sub">CEYI EVENT CONTRACT AI QUANTITATIVE</div></div></div>
        <div className="header-right">
          <div className="ws-status"><span className={'ws-dot ' + (wsOn ? 'online' : 'offline')} />{wsOn ? '实时已连接' : '离线'}</div>
          {lastChk && <div className="last-check">检测 {lastChk}</div>}
          <div className="header-price">{tick ? (<><div className="price-main">{fmt(tick.price)}</div><div className="price-change">{tick.change24h >= 0 ? '▲' : '▼'}{Math.abs(tick.change24h).toFixed(2)}% (24h)</div></>) : <div className="price-loading">价格加载中...</div>}</div>
        </div>
      </header>
      <nav className="nav">
        <button className={'nav-btn ' + (tab === 'dashboard' ? 'active' : '')} onClick={() => setTab('dashboard')}>📊 实时看板</button>
        <button className={'nav-btn ' + (tab === 'history' ? 'active' : '')} onClick={() => setTab('history')}>📋 信号记录</button>
        <button className={'nav-btn ' + (tab === 'stats' ? 'active' : '')} onClick={() => setTab('stats')}>📈 统计分析</button>
        <button className={'nav-btn ' + (tab === 'learning' ? 'active' : '')} onClick={() => setTab('learning')}>🧠 自学习</button>
        <button className={'nav-btn ' + (tab === 'settings' ? 'active' : '')} onClick={() => setTab('settings')}>⚙️ 设置</button>
      </nav>
      <main className="main">
        {tab === 'dashboard' ? (
          <div className="dashboard">
            <div className="card">
              <div className="card-title">📡 实时行情分析</div>
              <div className="indicators">{iR ? iR.map((x: any, i: number) => (<div key={i} className="ind-item"><span className="ind-label">{x.l}</span><span className="ind-value" style={{ color: x.c }}>{x.v}</span></div>)) : <div className="empty-state">📡 正在连接币安市场数据...</div>}</div>
              {score ? (
                <div className="regime-bar" style={{ borderColor: R[score.regime]?.c || '#b0bec5' }}>
                  <div className="rb-item"><span className="rb-label">行情状态</span><RegimeTag r={score.regime} /></div>
                  <div className="rb-item"><span className="rb-label">信号方向</span><span style={{ color: score.direction === 'long' ? '#00C853' : score.direction === 'short' ? '#E53935' : '#888', fontWeight: 700 }}>{score.direction === 'neutral' ? '⏸️ 观望' : score.direction === 'long' ? '🟢 看多 ↑' : '🔴 看空 ↓'}</span></div>
                  <div className="rb-item"><span className="rb-label">置信度</span><div className="conf-bar-wrap"><div className="conf-bar" style={{ width: score.confidence + '%', background: score.confidence >= 70 ? '#00C853' : score.confidence >= 50 ? '#D4A017' : '#E53935' }} /><span style={{ color: score.confidence >= 70 ? '#00C853' : '#D4A017', fontFamily: 'JetBrains Mono,monospace', fontWeight: 700 }}>{score.confidence}%</span></div></div>
                  <div className="rb-item"><span className="rb-label">激活因子</span><span style={{ color: 'var(--accent)', fontWeight: 700 }}>{score.longSignals}多/{score.shortSignals}空</span></div>
                </div>
              ) : null}
              <div className="card-footer">
                <button className={'btn-scan ' + (loading ? 'checking' : '')} onClick={trigger} disabled={loading}>{loading ? '⏳ 检测中...' : '🔍 立即检测'}</button>
                <span className="threshold-hint">阈值:{sets.confidence_threshold}% | {sets.check_interval_minutes || 5}分钟/次</span>
                {score?.activeFactors?.length > 0 ? <button className="btn-factor" onClick={() => setShowFp(!showFp)}>{showFp ? '🔒 隐藏' : '🔬 激活因子'}</button> : null}
                <button className="btn-factor" onClick={() => setShowLib(!showLib)}>{showLib ? '🔒 隐藏' : '📦 因子库'}</button>
              </div>
              {showFp && score?.activeFactors?.length > 0 ? (
                <div style={{ marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
                  <div style={{ display: 'flex', gap: 4, alignItems: 'flex-end', height: 72, padding: 8, background: 'var(--bg4)', borderRadius: 10, overflowX: 'auto', marginBottom: 16 }}>
                    {score.activeFactors.map((f: any, i: number) => (<div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, minWidth: 28 }}><div style={{ height: Math.min(Math.abs(f.score) * 2, 60), width: 16, borderRadius: '4px 4px 0 0', background: f.score > 0 ? '#00C853' : '#E53935' }} /><span style={{ fontSize: 9, color: 'var(--muted)', fontFamily: 'JetBrains Mono,monospace', writingMode: 'vertical-rl' }}>{ss(Number(f.score))}</span></div>))}
                  </div>
                  {Object.entries(FCATS).map(([key, cat]) => {
                    const items = score.activeFactors.filter((f: any) => f.category === key);
                    if (!items.length) return null;
                    return (<div key={key} style={{ marginBottom: 12, padding: '10px 12px', background: 'var(--bg4)', borderRadius: 12, borderLeft: '3px solid ' + cat.c }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: cat.c, marginBottom: 8 }}>{cat.l} ({items.length})</div>
                      {items.map((f: any, i: number) => (<div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', borderBottom: i < items.length - 1 ? '1px solid var(--border-light)' : 'none' }}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><span style={{ fontSize: 11, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: f.direction === 'long' ? 'rgba(0,200,83,0.12)' : 'rgba(229,57,53,0.12)', color: f.direction === 'long' ? '#00C853' : '#E53935' }}>{f.direction === 'long' ? '↑多' : '↓空'}</span><span style={{ fontSize: 12, color: 'var(--text)' }}>{f.description}</span></div>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><span style={{ fontFamily: 'JetBrains Mono,monospace', fontWeight: 700, fontSize: 13, color: f.score > 0 ? '#00C853' : '#E53935' }}>{ss(Number(f.score))}</span><span style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'JetBrains Mono,monospace' }}>{f.confidence}%</span></div>
                      </div>))}
                    </div>);
                  })}
                </div>
              ) : null}
              {showLib ? (
                <div style={{ marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 10, fontFamily: 'JetBrains Mono,monospace', letterSpacing: 1 }}>📦 因子库（共{ALL.length}个）| 绿色 = 已激活</div>
                  {Object.entries(FCATS).map(([key, cat]) => {
                    const items = ALL.filter(f => f.c === key);
                    if (!items.length) return null;
                    return (<div key={key} style={{ marginBottom: 12 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: cat.c, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 }}>{cat.l}</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {items.map(f => {
                          const on = activeSet.has(f.n);
                          return (<div key={f.n} style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid ' + (on ? 'var(--accent-light)' : 'var(--border-light)'), background: on ? 'rgba(74,144,226,0.10)' : 'var(--bg4)', minWidth: 140, maxWidth: 200 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <div style={{ width: 6, height: 6, borderRadius: '50%', background: on ? '#00C853' : 'var(--border)', boxShadow: on ? '0 0 6px #00C853' : 'none', flexShrink: 0 }} />
                              <div><div style={{ fontSize: 11, fontWeight: 600, color: on ? 'var(--accent-dark)' : 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 130 }}>{f.d}</div><div style={{ fontSize: 9, color: 'var(--muted)', fontFamily: 'JetBrains Mono,monospace' }}>{f.n}</div></div>
                              {on ? <span style={{ fontSize: 9, background: '#00C853', color: '#fff', padding: '1px 4px', borderRadius: 4, fontWeight: 700 }}>ON</span> : null}
                            </div>
                          </div>);
                        })}
                      </div>
                    </div>);
                  })}
                </div>
              ) : null}
            </div>
            <div className="card">
              <div className="card-title">📡 活跃信号 <span style={{ color: actSigs.length > 0 ? 'var(--accent)' : 'var(--muted)' }}>({actSigs.length})</span></div>
              {actSigs.length === 0 ? <div className="empty-state">暂无活跃信号 · 每{sets.check_interval_minutes || 5}分钟自动检测一次</div> : (
                <div className="signal-list">{actSigs.map((s: any) => (<div key={s.signal_id || s.signalId} className={'signal-item ' + s.direction}>
                  <div className="sig-header"><span className="sig-dir">{s.direction === 'long' ? '🟢 做多' : '🔴 做空'}</span><span className="sig-conf">置信度 {s.confidence}%</span></div>
                  <div className="sig-price">{fmt(s.entry_price || s.price)}</div>
                  <div className="sig-meta">入场: {fmtT(s.entry_time || s.entryTime)} → 结算: {fmtT(s.expire_time || s.expireTime)}</div>
                  <div className="sig-regime"><RegimeTag r={s.regime} /></div>
                </div>))}</div>
              )}
            </div>
            <div className="card">
              <div className="card-title">📊 统计概览</div>
              <div className="stats-grid">
                <div className="stat-box"><div className="stat-value" style={{ color: wrC(tot.winRate) }}>{(tot.winRate * 100).toFixed(1)}%</div><div className="stat-label">总胜率</div></div>
                <div className="stat-box"><div className="stat-value">{tot.total || 0}</div><div className="stat-label">总信号数</div></div>
                <div className="stat-box"><div className="stat-value" style={{ color: (tot.wins || 0) >= (tot.losses || 0) ? '#00C853' : '#E53935' }}>{(tot.wins || 0)}胜/{(tot.losses || 0)}负</div><div className="stat-label">胜负场次</div></div>
                <div className="stat-box"><div className="stat-value" style={{ color: (tot.total_pnl || 0) >= 0 ? '#00C853' : '#E53935' }}>{fmtP(tot.total_pnl)}</div><div className="stat-label">累计收益率</div></div>
              </div>
            </div>
            <div className="card" style={{ gridColumn: '1 / -1', padding: 0 }}>
              <div className="card-title" style={{ padding: '16px 20px 8px' }}>🕐 近期信号记录</div>
              <table className="table">
                <thead><tr><th>入场时间</th><th>方向</th><th>入场价</th><th>结算价</th><th>结果</th><th>置信度</th><th>行情</th><th>因子</th></tr></thead>
                <tbody>
                  {sigs.slice(0, 10).map((s: any) => (<tr key={s.signal_id} className={s.result === 'win' ? 'row-win' : s.result === 'loss' ? 'row-loss' : ''}>
                    <td>{fmtT(s.entry_time)}</td><td><span className={'dir-tag ' + s.direction}>{s.direction === 'long' ? '做多' : '做空'}</span></td><td>{fmt(s.entry_price)}</td><td>{s.settle_price ? fmt(s.settle_price) : '—'}</td>
                    <td>{!s.result ? <span className="result-tag pending">⏳ 进行中</span> : <span className={'result-tag ' + s.result}>{s.result === 'win' ? '✅ 盈利' : '❌ 亏损'} {fmtP(s.pnl)}</span>}</td>
                    <td><span style={{ color: 'var(--accent)', fontFamily: 'JetBrains Mono,monospace' }}>{s.confidence}%</span></td><td><RegimeTag r={s.regime} /></td>
                    <td style={{ fontSize: 10, color: 'var(--muted)', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fl(s.factors_used)}</td>
                  </tr>))}
                  {sigs.length === 0 ? <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--muted)', padding: 30 }}>暂无信号记录</td></tr> : null}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
        {tab === 'history' ? (
          <div className="card" style={{ padding: 0 }}>
            <div className="card-title" style={{ padding: '16px 20px 8px' }}>📋 全部信号记录</div>
            <table className="table">
              <thead><tr><th>入场时间</th><th>结算时间</th><th>方向</th><th>入场价</th><th>结算价</th><th>涨跌</th><th>结果</th><th>置信度</th><th>行情</th></tr></thead>
              <tbody>
                {sigs.filter((s: any) => s.result).map((s: any) => (<tr key={s.signal_id} className={s.result === 'win' ? 'row-win' : 'row-loss'}>
                  <td>{fmtT(s.entry_time)}</td><td>{s.settle_time ? fmtT(s.settle_time) : '—'}</td><td><span className={'dir-tag ' + s.direction}>{s.direction === 'long' ? '做多' : '做空'}</span></td><td>{fmt(s.entry_price)}</td><td>{s.settle_price ? fmt(s.settle_price) : '—'}</td>
                  <td style={{ color: s.pnl > 0 ? '#00C853' : '#E53935', fontFamily: 'JetBrains Mono,monospace' }}>{fmtP(s.pnl)}</td>
                  <td><span className={'result-tag ' + s.result}>{s.result === 'win' ? '✅ 盈利' : '❌ 亏损'}</span></td><td>{s.confidence}%</td><td><RegimeTag r={s.regime} /></td>
                </tr>))}
                {sigs.filter((s: any) => !s.result).length > 0 ? (<><tr><td colSpan={9} className="row-divider">⏳ 进行中</td></tr>{sigs.filter((s: any) => !s.result).map((s: any) => (<tr key={s.signal_id}><td>{fmtT(s.entry_time)}</td><td>—</td><td><span className={'dir-tag ' + s.direction}>{s.direction === 'long' ? '做多' : '做空'}</span></td><td>{fmt(s.entry_price)}</td><td>待结算</td><td>—</td><td><span className="result-tag pending">⏳</span></td><td>{s.confidence}%</td><td><RegimeTag r={s.regime} /></td></tr>))}</> ) : null}
                {sigs.length === 0 ? <tr><td colSpan={9} style={{ textAlign: 'center', color: 'var(--muted)', padding: 40 }}>暂无记录</td></tr> : null}
              </tbody>
            </table>
          </div>
        ) : null}
        {tab === 'stats' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="card">
              <div className="card-title">📈 胜率概况</div>
              <div className="time-tabs">
                <button className={'time-tab ' + (timeR === 'today' ? 'active' : '')} onClick={() => setTimeR('today')}>今天</button>
                <button className={'time-tab ' + (timeR === '15d' ? 'active' : '')} onClick={() => setTimeR('15d')}>近15天</button>
                <button className={'time-tab ' + (timeR === '30d' ? 'active' : '')} onClick={() => setTimeR('30d')}>近30天</button>
              </div>
              <div className="stats-grid">
                <div className="stat-box"><div className="stat-value" style={{ color: wrC(tot.winRate) }}>{(tot.winRate * 100).toFixed(1)}%</div><div className="stat-label">胜率</div></div>
                <div className="stat-box"><div className="stat-value">{tot.total || 0}</div><div className="stat-label">总信号</div></div>
                <div className="stat-box"><div className="stat-value" style={{ color: (tot.wins || 0) >= (tot.losses || 0) ? '#00C853' : '#E53935' }}>{(tot.wins || 0)}胜 {(tot.losses || 0)}负</div><div className="stat-label">胜负</div></div>
                <div className="stat-box"><div className="stat-value" style={{ color: (tot.total_pnl || 0) >= 0 ? '#00C853' : '#E53935' }}>{fmtP(tot.total_pnl)}</div><div className="stat-label">累计收益</div></div>
              </div>
            </div>
            <div className="card">
              <div className="card-title">📈 每日统计明细</div>
              <table className="table">
                <thead><tr><th>日期</th><th>总信号</th><th>盈利</th><th>亏损</th><th>胜率</th><th>日收益率</th></tr></thead>
                <tbody>
                  {daily.map((t: any) => (<tr key={t.date}><td>{t.date}</td><td>{t.total_signals}</td><td style={{ color: '#00C853' }}>{t.win_signals}</td><td style={{ color: '#E53935' }}>{t.loss_signals}</td><td style={{ color: wrC(t.win_rate) }}>{(t.win_rate * 100).toFixed(1)}%</td><td style={{ color: t.total_pnl >= 0 ? '#00C853' : '#E53935' }}>{fmtP(t.total_pnl)}</td></tr>))}
                  {daily.length === 0 ? <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--muted)', padding: 30 }}>暂无每日数据</td></tr> : null}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
        {tab === 'learning' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="card">
              <div className="card-title">🧠 因子有效性排名</div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 12 }}>基于最近信号胜率自动调整因子权重</div>
              <table className="table">
                <thead><tr><th>排名</th><th>因子</th><th>描述</th><th>方向</th><th>激活</th><th>胜率</th><th>权重</th></tr></thead>
                <tbody>
                  {ALL.map((f, idx) => {
                    const fs = learn?.factorStats?.[f.n] || { count: 0, wins: 0, losses: 0, weight: 1 };
                    const wr = fs.count > 0 ? fs.wins / fs.count : 0;
                    return (<tr key={f.n}>
                      <td>{idx + 1}</td>
                      <td style={{ fontFamily: 'JetBrains Mono,monospace', fontSize: 10, color: 'var(--muted)' }}>{f.n}</td>
                      <td>{f.d}</td>
                      <td><span style={{ color: FCATS[f.c]?.c }}>{FCATS[f.c]?.l}</span></td>
                      <td>{fs.count}</td>
                      <td style={{ color: wrC(wr) }}>{fs.count > 0 ? (wr * 100).toFixed(1) + '%' : '—'}</td>
                      <td><span style={{ fontFamily: 'JetBrains Mono,monospace', color: fs.weight > 1.2 ? '#00C853' : fs.weight < 0.8 ? '#E53935' : 'var(--text)' }}>{fs.weight.toFixed(2)}x</span></td>
                    </tr>);
                  })}
                </tbody>
              </table>
            </div>
            <div className="card">
              <div className="card-title">📜 亏损复盘日志</div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 12 }}>系统自动记录亏损信号原因，持续优化策略</div>
              {learn?.lossLogs?.length > 0 ? learn.lossLogs.slice(0, 10).map((l: any, i: number) => (
                <div key={i} style={{ padding: '10px 14px', background: 'var(--bg4)', borderRadius: 10, marginBottom: 8, borderLeft: '3px solid #E53935' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontFamily: 'JetBrains Mono,monospace', fontSize: 11, color: 'var(--muted)' }}>{fmtT(l.time)}</span>
                    <span style={{ color: '#E53935', fontWeight: 700, fontSize: 12 }}>{l.direction === 'long' ? '做多' : '做空'} {l.pnl < 0 ? (l.pnl * 100).toFixed(2) + '%' : ''}</span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text)' }}>{l.reason}</div>
                  <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>因子: {l.factors?.join(', ')}</div>
                </div>
              )) : <div style={{ color: 'var(--muted)', textAlign: 'center', padding: 30 }}>暂无复盘记录</div>}
            </div>
          </div>
        ) : null}
        {tab === 'settings' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 700 }}>
            <div className="card">
              <div className="card-title">⚙️ Webhook 配置</div>
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6, display: 'block' }}>做多信号 Webhook URL</label>
                <input className="input" type="text" placeholder="https://your-webhook.com/long" value={draft.webhook_long_url || ''} onChange={e => setDraft({ ...draft, webhook_long_url: e.target.value })} />
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6, display: 'block' }}>做空信号 Webhook URL</label>
                <input className="input" type="text" placeholder="https://your-webhook.com/short" value={draft.webhook_short_url || ''} onChange={e => setDraft({ ...draft, webhook_short_url: e.target.value })} />
              </div>
            </div>
            <div className="card">
              <div className="card-title">🎯 检测参数</div>
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6, display: 'block' }}>置信度阈值: {draft.confidence_threshold || 70}%</label>
                <input className="input" type="range" min="30" max="95" value={draft.confidence_threshold || 70} onChange={e => setDraft({ ...draft, confidence_threshold: e.target.value })} style={{ width: '100%' }} />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--muted)' }}><span>30%</span><span>70%</span><span>95%</span></div>
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6, display: 'block' }}>自动检测频率（分钟/次）</label>
                <select className="input" value={draft.check_interval_minutes || '5'} onChange={e => setDraft({ ...draft, check_interval_minutes: e.target.value })}>
                  <option value="1">1 分钟</option><option value="3">3 分钟</option><option value="5">5 分钟</option><option value="10">10 分钟</option><option value="15">15 分钟</option><option value="30">30 分钟</option>
                </select>
              </div>
            </div>
            <button className="btn-scan" onClick={save}>💾 保存设置</button>
          </div>
        ) : null}
      </main>
    </div>
  );
}
