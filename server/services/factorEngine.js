// ============================================================
//  动态因子评分引擎
// ============================================================

export function detectMarketRegime(klines) {
  if (klines.length < 60) return 'mixed';
  const closes = klines.map(k => k.close);
  const volumes = klines.map(k => k.volume || 0);
  const atr = calculateATR(klines, 14);
  const ma5  = sma(closes, 5);
  const ma20 = sma(closes, 20);
  const ma60 = sma(closes, 60);
  const adx = calculateADXSimple(klines, 14);
  const bbp = calculateBandwidth(closes, 20);
  const rsi = calculateRSI(closes, 14);
  const volStd = Math.sqrt(volumes.slice(-20).reduce((a,b)=>a+(b-avg(volumes.slice(-20)))**2,0)/20);
  const volAvg = avg(volumes.slice(-20));
  const volRatio = volAvg > 0 ? volStd / volAvg : 1;
  const trendScore = (ma5 > ma20 && ma20 > ma60) ? 1 : (ma5 < ma20 && ma20 < ma60) ? 0 : 0.5;
  const isTrending = adx > 35 && (trendScore === 1 || trendScore === 0);
  const isVolatile = bbp > 0.6;
  const isRsiExtreme = rsi > 75 || rsi < 25;
  const isHighVolume = volRatio > 0.5;
  if (isTrending && !isVolatile) return 'trend';
  else if (isVolatile && !isTrending) return 'volatility';
  else if (isRsiExtreme && !isTrending) return 'mean_reversion';
  else if (isHighVolume && !isTrending && !isVolatile) return 'momentum';
  else return 'mixed';
}

function avg(arr) { return arr.reduce((a,b)=>a+b,0)/arr.length; }

// ============================================================
//  因子库
// ============================================================

export const FACTOR_LIBRARY = {

  TREND_MA_GOLDEN: {
    name: 'TREND_MA_GOLDEN', category: 'trend', description: '均线黄金叉',
    check(klines) {
      const c = klines.map(k=>k.close);
      const ma5=sma(c,5), ma20=sma(c,20);
      const p5=sma(c.slice(0,-1),5), p20=sma(c.slice(0,-1),20);
      const bull=ma5>ma20&&p5<=p20, bear=ma5<ma20&&p5>=p20;
      return { active: bull||bear, score: bull?20:bear?-20:0, direction: bull?'long':bear?'short':'neutral', confidence: Math.abs(ma5-ma20)/ma20*100*3 };
    }
  },

  TREND_SUPERTREND: {
    name: 'TREND_SUPERTREND', category: 'trend', description: '超级趋势线',
    check(klines) {
      const st=calcST(klines,10,3), pst=calcST(klines.slice(0,-1),10,3);
      if (!st||!pst) return { active:false,score:0,direction:'neutral',confidence:0 };
      return { active:true, score: st==='up'&&pst==='down'?18:st==='down'&&pst==='up'?-18:st==='up'?5:-5, direction: st==='up'&&pst==='down'?'long':st==='down'&&pst==='up'?'short':st==='up'?'neutral':'neutral', confidence:60 };
    }
  },

  TREND_ADX_STRONG: {
    name: 'TREND_ADX_STRONG', category: 'trend', description: 'ADX趋势强度',
    check(klines) {
      const adx=calculateADXSimple(klines,14);
      if (adx<25) return { active:false,score:0,direction:'neutral',confidence:0 };
      const {plusDI,minusDI}=calcADXParts(klines,14);
      const bull=plusDI>minusDI;
      return { active:true, score: Math.min(adx*0.5,25)*(bull?1:-1), direction: bull?'long':'short', confidence: Math.min(adx,90) };
    }
  },

  REVERSION_RSI_OVERBOUGHT: {
    name: 'REVERSION_RSI_OVERBOUGHT', category: 'mean_reversion', description: 'RSI超买',
    check(klines) {
      const rsi=calculateRSI(klines.map(k=>k.close),14);
      if (rsi<70) return { active:false,score:0,direction:'neutral',confidence:0 };
      return { active:true, score: -(rsi-70)/30*15, direction:'short', confidence:(rsi-70)/30*80 };
    }
  },

  REVERSION_RSI_OVERSOLD: {
    name: 'REVERSION_RSI_OVERSOLD', category: 'mean_reversion', description: 'RSI超卖',
    check(klines) {
      const rsi=calculateRSI(klines.map(k=>k.close),14);
      if (rsi>30) return { active:false,score:0,direction:'neutral',confidence:0 };
      return { active:true, score: (30-rsi)/30*15, direction:'long', confidence:(30-rsi)/30*80 };
    }
  },

  REVERSION_BOLL_LOWER: {
    name: 'REVERSION_BOLL_LOWER', category: 'mean_reversion', description: '布林下轨反弹',
    check(klines) {
      const c=klines.map(k=>k.close);
      const bb=calcBB(c,20);
      const price=c[c.length-1], prev=c[c.length-2];
      const bounce=price>=bb.lower&&prev<bb.lower, touch=price<bb.lower;
      return { active:bounce||touch, score: bounce?22:touch?18:0, direction:'long', confidence:bounce?75:65 };
    }
  },

  REVERSION_BOLL_UPPER: {
    name: 'REVERSION_BOLL_UPPER', category: 'mean_reversion', description: '布林上轨反转',
    check(klines) {
      const c=klines.map(k=>k.close);
      const bb=calcBB(c,20);
      const price=c[c.length-1], prev=c[c.length-2];
      const bounce=price<=bb.upper&&prev>bb.upper, touch=price>bb.upper;
      return { active:bounce||touch, score: bounce?-22:touch?-18:0, direction:'short', confidence:bounce?75:65 };
    }
  },

  REVERSION_KDJ_OVERSOLD: {
    name: 'REVERSION_KDJ_OVERSOLD', category: 'mean_reversion', description: 'KDJ超卖金叉',
    check(klines) {
      const kd=calcKDJ(klines), pkd=calcKDJ(klines.slice(0,-1));
      if (!kd.k) return { active:false,score:0,direction:'neutral',confidence:0 };
      const bull=kd.k<20&&kd.d<20&&kd.k>kd.d&&pkd.k<=pkd.d;
      return { active:bull, score:bull?18:0, direction:'long', confidence:60 };
    }
  },

  REVERSION_KDJ_OVERBOUGHT: {
    name: 'REVERSION_KDJ_OVERBOUGHT', category: 'mean_reversion', description: 'KDJ超买死叉',
    check(klines) {
      const kd=calcKDJ(klines), pkd=calcKDJ(klines.slice(0,-1));
      if (!kd.k) return { active:false,score:0,direction:'neutral',confidence:0 };
      const bear=kd.k>80&&kd.d>80&&kd.k<kd.d&&pkd.k>=pkd.d;
      return { active:bear, score:bear?-18:0, direction:'short', confidence:60 };
    }
  },

  MOMENTUM_RSI_DIVERGENCE_BULL: {
    name: 'MOMENTUM_RSI_DIVERGENCE_BULL', category: 'momentum', description: 'RSI底背离',
    check(klines) {
      const c=klines.map(k=>k.close);
      const rsiArr=calcRSIArr(c,14);
      if (rsiArr.length<30) return { active:false,score:0,direction:'neutral',confidence:0 };
      const recent=rsiArr.slice(-10), older=rsiArr.slice(-30,-10);
      const priceLower=c[c.length-1]<c[c.length-11];
      const rsiHigher=recent[recent.length-1]>recent[Math.floor(recent.length/2)];
      return { active:priceLower&&rsiHigher, score:priceLower&&rsiHigher?22:0, direction:'long', confidence:70 };
    }
  },

  MOMENTUM_RSI_DIVERGENCE_BEAR: {
    name: 'MOMENTUM_RSI_DIVERGENCE_BEAR', category: 'momentum', description: 'RSI顶背离',
    check(klines) {
      const c=klines.map(k=>k.close);
      const rsiArr=calcRSIArr(c,14);
      if (rsiArr.length<30) return { active:false,score:0,direction:'neutral',confidence:0 };
      const recent=rsiArr.slice(-10), older=rsiArr.slice(-30,-10);
      const priceHigher=c[c.length-1]>c[c.length-11];
      const rsiLower=recent[recent.length-1]<recent[Math.floor(recent.length/2)];
      return { active:priceHigher&&rsiLower, score:priceHigher&&rsiLower?-22:0, direction:'short', confidence:70 };
    }
  },

  MOMENTUM_MACD_GOLDEN: {
    name: 'MOMENTUM_MACD_GOLDEN', category: 'momentum', description: 'MACD零轴上金叉',
    check(klines) {
      const c=klines.map(k=>k.close);
      const m=calcMACD(c);
      const pm=calcMACD(c.slice(0,-1));
      if (!m||!pm) return { active:false,score:0,direction:'neutral',confidence:0 };
      const bull=m.macd>0&&m.macd>m.signal&&pm.macd<=pm.signal;
      return { active:bull, score:bull?16:0, direction:'long', confidence:60 };
    }
  },

  MOMENTUM_MACD_DEATH: {
    name: 'MOMENTUM_MACD_DEATH', category: 'momentum', description: 'MACD零轴下死叉',
    check(klines) {
      const c=klines.map(k=>k.close);
      const m=calcMACD(c), pm=calcMACD(c.slice(0,-1));
      if (!m||!pm) return { active:false,score:0,direction:'neutral',confidence:0 };
      const bear=m.macd<0&&m.macd<m.signal&&pm.macd>=pm.signal;
      return { active:bear, score:bear?-16:0, direction:'short', confidence:60 };
    }
  },

  MOMENTUM_VOLUME_SPIKE: {
    name: 'MOMENTUM_VOLUME_SPIKE', category: 'momentum', description: '成交量突增',
    check(klines) {
      if (klines.length<20) return { active:false,score:0,direction:'neutral',confidence:0 };
      const v=klines.map(k=>k.volume||0);
      const rVol=avg(v.slice(-5)), aVol=avg(v.slice(-20,-5));
      const ratio=rVol/(aVol+0.001);
      if (ratio<1.5) return { active:false,score:0,direction:'neutral',confidence:0 };
      const c=klines.map(k=>k.close);
      const up=c[c.length-1]>c[c.length-5];
      return { active:true, score:Math.min((ratio-1.5)*10,20)*(up?1:-1), direction:up?'long':'short', confidence:Math.min(ratio*20,80) };
    }
  },

  MOMENTUM_MFI_EXTREME: {
    name: 'MOMENTUM_MFI_EXTREME', category: 'momentum', description: 'MFI资金流量极值',
    check(klines) {
      const mfi=calcMFI(klines,14);
      if (mfi<20) return { active:true, score:18, direction:'long', confidence:75 };
      if (mfi>80) return { active:true, score:-18, direction:'short', confidence:75 };
      return { active:false,score:0,direction:'neutral',confidence:0 };
    }
  },

  VOLATILITY_BOLL_SQUEEZE: {
    name: 'VOLATILITY_BOLL_SQUEEZE', category: 'volatility', description: '布林带收口爆发',
    check(klines) {
      if (klines.length<40) return { active:false,score:0,direction:'neutral',confidence:0 };
      const c=klines.map(k=>k.close);
      const bb=calcBB(c,20);
      const w=(bb.upper-bb.lower)/bb.middle;
      const prevWs=[];
      for(let i=40;i<klines.length;i++){
        const bb2=calcBB(c.slice(i-20,i),20);
        prevWs.push((bb2.upper-bb2.lower)/bb2.middle);
      }
      if (prevWs.length<5) return { active:false,score:0,direction:'neutral',confidence:0 };
      const avgW=avg(prevWs);
      if (w>=avgW*0.7) return { active:false,score:0,direction:'neutral',confidence:0 };
      const bull=c[c.length-1]-bb.lower < bb.upper-c[c.length-1];
      return { active:true, score:(bull?1:-1)*20, direction:bull?'long':'short', confidence:65 };
    }
  },

  VOLATILITY_ATR_BREAK: {
    name: 'VOLATILITY_ATR_BREAK', category: 'volatility', description: 'ATR波动率爆发',
    check(klines) {
      const atr=calculateATR(klines,14);
      const atrH=[];
      for(let i=30;i<klines.length;i++) atrH.push(calculateATR(klines.slice(i-14,i),14));
      if (atrH.length<5) return { active:false,score:0,direction:'neutral',confidence:0 };
      const avgAtr=avg(atrH);
      if (atr<=avgAtr) return { active:false,score:0,direction:'neutral',confidence:0 };
      const ratio=atr/avgAtr;
      const c=klines.map(k=>k.close);
      const up=c[c.length-1]>c[c.length-2];
      return { active:true, score:Math.min((ratio-1)*30,22)*(up?1:-1), direction:up?'long':'short', confidence:Math.min(ratio*30,80) };
    }
  },

  REGIME_TREND_PERSISTENCE: {
    name: 'REGIME_TREND_PERSISTENCE', category: 'trend', description: '均线多头/空头排列',
    check(klines) {
      const c=klines.map(k=>k.close);
      const m5=emaCalc(c,5), m20=emaCalc(c,20), m60=emaCalc(c,60);
      if (m5>m20&&m20>m60) return { active:true,score:20,direction:'long',confidence:80 };
      if (m5<m20&&m20<m60) return { active:true,score:-20,direction:'short',confidence:80 };
      return { active:false,score:0,direction:'neutral',confidence:0 };
    }
  },

  REGIME_SIDEWAYS: {
    name: 'REGIME_SIDEWAYS', category: 'mean_reversion', description: '横盘震荡识别',
    check(klines) {
      const c=klines.map(k=>k.close);
      const bb=calcBB(c,20);
      const w=(bb.upper-bb.lower)/bb.middle;
      const adx=calculateADXSimple(klines,14);
      if (w<0.03&&adx<25) return { active:true,score:5,direction:'neutral',confidence:70 };
      return { active:false,score:0,direction:'neutral',confidence:0 };
    }
  },

  VOLATILITY_WILLIAMS_R: {
    name: 'VOLATILITY_WILLIAMS_R', category: 'volatility', description: '威廉指标极值',
    check(klines) {
      const wr=calcWR(klines,14);
      if (wr<-80) return { active:true,score:20,direction:'long',confidence:65 };
      if (wr>-20) return { active:true,score:-12,direction:'short',confidence:50 };
      return { active:false,score:0,direction:'neutral',confidence:0 };
    }
  },

  TIMING_CCI_OVERSOLD: {
    name: 'TIMING_CCI_OVERSOLD', category: 'momentum', description: 'CCI超卖',
    check(klines) {
      const cci=calcCCI(klines,20);
      if (cci>-100) return { active:false,score:0,direction:'neutral',confidence:0 };
      return { active:true,score:14,direction:'long',confidence:60 };
    }
  }
};

const REGIME_FACTORS = {
  trend:         ['TREND_MA_GOLDEN','TREND_SUPERTREND','TREND_ADX_STRONG','REGIME_TREND_PERSISTENCE','MOMENTUM_MACD_GOLDEN','MOMENTUM_MACD_DEATH','VOLATILITY_ATR_BREAK','MOMENTUM_VOLUME_SPIKE'],
  mean_reversion:['REVERSION_RSI_OVERSOLD','REVERSION_RSI_OVERBOUGHT','REVERSION_BOLL_LOWER','REVERSION_BOLL_UPPER','REVERSION_KDJ_OVERSOLD','REVERSION_KDJ_OVERBOUGHT','REGIME_SIDEWAYS','VOLATILITY_WILLIAMS_R','TIMING_CCI_OVERSOLD'],
  momentum:     ['MOMENTUM_RSI_DIVERGENCE_BULL','MOMENTUM_RSI_DIVERGENCE_BEAR','MOMENTUM_MACD_GOLDEN','MOMENTUM_MACD_DEATH','MOMENTUM_VOLUME_SPIKE','MOMENTUM_MFI_EXTREME','VOLATILITY_WILLIAMS_R'],
  volatility:    ['VOLATILITY_BOLL_SQUEEZE','VOLATILITY_ATR_BREAK','VOLATILITY_WILLIAMS_R','MOMENTUM_VOLUME_SPIKE','REVERSION_BOLL_LOWER','REVERSION_BOLL_UPPER'],
  mixed:         ['TREND_SUPERTREND','REVERSION_RSI_OVERSOLD','REVERSION_RSI_OVERBOUGHT','MOMENTUM_MACD_GOLDEN','MOMENTUM_MACD_DEATH','MOMENTUM_VOLUME_SPIKE','REGIME_TREND_PERSISTENCE','VOLATILITY_WILLIAMS_R']
};

export function scoreAllFactors(klinesByInterval) {
  const k5 = klinesByInterval['5m']||[];
  if (k5.length<30) return null;
  const regime=detectMarketRegime(k5);
  const fnames=REGIME_FACTORS[regime]||REGIME_FACTORS['mixed'];
  let total=0;
  const active=[];
  for (const name of fnames) {
    const f=FACTOR_LIBRARY[name];
    if (!f) continue;
    const r=f.check(k5);
    if (r&&r.active) {
      total+=r.score*(f.weight||1);
      active.push({ name:f.name, description:f.description, category:f.category, score:r.score, direction:r.direction, confidence:r.confidence });
    }
  }
  const longs=active.filter(f=>f.direction==='long').length;
  const shorts=active.filter(f=>f.direction==='short').length;
  let dir='neutral';
  if (longs>shorts&&longs>=2) dir='long';
  else if (shorts>longs&&shorts>=2) dir='short';
  const conf=Math.min(Math.abs(total)*0.9+Math.abs(longs-shorts)*3,99);
  return {
    regime, rawScore:total, confidence:Math.round(conf), direction:dir,
    longSignals:longs, shortSignals:shorts, activeFactors:active,
    indicators:{ rsi:Math.round(calculateRSI(k5.map(k=>k.close),14)), adx:Math.round(calculateADXSimple(k5,14)), macd:calcMACD(k5.map(k=>k.close)), kdj:calcKDJ(k5), boll:calcBB(k5.map(k=>k.close),20), price:k5[k5.length-1]?.close }
  };
}

// ============================================================
//  技术指标函数
// ============================================================

function sma(arr,p){ if(arr.length<p)return arr[arr.length-1]; return avg(arr.slice(-p)); }
function emaCalc(arr,p){ if(!arr.length)return 0; const k=2/(p+1); let v=arr[0]; for(let i=1;i<arr.length;i++)v=arr[i]*k+v*(1-k); return v; }

export function calculateRSI(closes,p=14){ const a=calcRSIArr(closes,p); return a[a.length-1]||50; }

function calcRSIArr(closes,p=14){
  if(closes.length<2)return[50];
  const gains=[],losses=[];
  for(let i=1;i<closes.length;i++){ const d=closes[i]-closes[i-1]; gains.push(d>0?d:0); losses.push(d<0?-d:0); }
  const rsi=[]; let ag=0,al=0;
  for(let i=0;i<gains.length;i++){
    if(i<p){ag+=gains[i];al+=losses[i];}
    if(i===p-1){ag/=p;al/=p;}
    else if(i>=p){ag=(ag*(p-1)+gains[i])/p;al=(al*(p-1)+losses[i])/p;}
    rsi.push(i<p-1?50:(al===0?100:100-100/(1+ag/(al||0.001))));
  }
  return rsi;
}

export function calculateATR(klines,p=14){
  if(klines.length<2)return 0;
  const trs=[];
  for(let i=1;i<klines.length;i++){
    const h=klines[i].high,l=klines[i].low,pc=klines[i-1].close;
    trs.push(Math.max(h-l,Math.abs(h-pc),Math.abs(l-pc)));
  }
  if(trs.length<p)return trs[trs.length-1]||0;
  let a=avg(trs.slice(0,p));
  for(let i=p;i<trs.length;i++)a=(a*(p-1)+trs[i])/p;
  return a;
}

export function calculateADXSimple(klines,p=14){
  if(klines.length<p*2)return 25;
  const {plusDI,minusDI}=calcADXParts(klines,p);
  const dx=100*Math.abs(plusDI-minusDI)/(plusDI+minusDI+0.001);
  return Math.min(Math.max(dx,0),100);
}

function calcADXParts(klines,p=14){
  if(klines.length<p+1)return{plusDI:50,minusDI:50};
  const trs=[],pd=[],md=[];
  for(let i=1;i<klines.length;i++){
    const h=klines[i].high,l=klines[i].low,ph=klines[i-1].high,pl=klines[i-1].low;
    trs.push(Math.max(h-l,Math.abs(h-pl),Math.abs(l-ph)));
    pd.push(h-ph>pl-l?Math.max(h-ph,0):0);
    md.push(pl-l>h-ph?Math.max(pl-l,0):0);
  }
  const atr=avg(trs.slice(0,p));
  return{plusDI:avg(pd.slice(0,p))/(atr+0.001)*100,minusDI:avg(md.slice(0,p))/(atr+0.001)*100};
}

export function calcBB(closes,p=20){
  if(closes.length<p){const v=closes[closes.length-1];return{upper:v*1.02,middle:v,lower:v*0.98};}
  const m=sma(closes,p);
  const std=Math.sqrt(avg(closes.slice(-p).map(c=>(c-m)**2)));
  return{upper:m+2*std,middle:m,lower:m-2*std};
}

function calculateBandwidth(closes,p=20){ const bb=calcBB(closes,p); return(bb.upper-bb.lower)/bb.middle; }

export function calcKDJ(klines,n=9){
  if(klines.length<n)return{k:50,d:50,j:50};
  const lows=klines.map(k=>k.low),highs=klines.map(k=>k.high);
  const rsv=[];
  for(let i=n-1;i<klines.length;i++){
    const ll=Math.min(...lows.slice(i-n+1,i+1));
    const hh=Math.max(...highs.slice(i-n+1,i+1));
    rsv.push(hh===ll?50:(klines[i].close-ll)/(hh-ll)*100);
  }
  if(!rsv.length)return{k:50,d:50,j:50};
  let k=50,d=50;
  const ks=[],ds=[];
  for(const r of rsv){k=2/3*k+1/3*r;d=2/3*d+1/3*k;ks.push(k);ds.push(d);}
  const kk=ks[ks.length-1],dd=ds[ds.length-1];
  return{k:kk,d:dd,j:3*kk-2*dd};
}

export function calcMACD(closes){
  if(closes.length<26)return null;
  const ema12=emaCalc(closes,12),ema26=emaCalc(closes,26);
  const macd=ema12-ema26;
  const macdSeries=[];
  for(let i=26;i<closes.length;i++) macdSeries.push(emaCalc(closes.slice(i-26,i+1),12)-emaCalc(closes.slice(i-26,i+1),26));
  const signal=emaCalc(macdSeries,9);
  return{macd,signal,histogram:macd-signal};
}

function calcST(klines,p,m){
  if(klines.length<p)return null;
  const atr=calculateATR(klines,p);
  const hl2=klines.map((k,i)=>(k.high+k.low)/2);
  const cur=hl2[hl2.length-1];
  let up=cur-m*atr,down=cur+m*atr;
  for(let i=p;i<hl2.length;i++){
    up=Math.max(up,cur-m*atr);
    down=Math.min(down,cur+m*atr);
  }
  return klines[klines.length-1].close>down?'up':klines[klines.length-1].close<up?'down':null;
}

export function calcMFI(klines,p=14){
  if(klines.length<p+1)return 50;
  const tp=klines.map(k=>(k.high+k.low+k.close)/3);
  const mf=[];
  for(let i=p;i<tp.length;i++){
    const prev=tp[i-1],cur=tp[i];
    mf.push(cur>prev?(klines[i].volume||0)*cur:(klines[i].volume||0)*cur*-1);
  }
  const pos=mf.filter(v=>v>0).reduce((a,b)=>a+b,0);
  const neg=Math.abs(mf.filter(v=>v<0).reduce((a,b)=>a+b,0));
  return neg===0?100:100-100/(1+pos/(neg||0.001));
}

function calcWR(klines,p=14){
  if(klines.length<p)return -50;
  const highs=klines.map(k=>k.high),lows=klines.map(k=>k.low);
  const hh=Math.max(...highs.slice(-p)),ll=Math.min(...lows.slice(-p));
  if(hh===ll)return -50;
  return -100*(hh-klines[klines.length-1].close)/(hh-ll);
}

function calcCCI(klines,p=20){
  if(klines.length<p)return 0;
  const tp=klines.map(k=>(k.high+k.low+k.close)/3);
  const smaTP=sma(tp,p);
  const c=tp[tp.length-1];
  const mad=avg(tp.slice(-p).map(v=>Math.abs(v-smaTP)));
  if(mad===0)return 0;
  return(c-smaTP)/(0.015*mad);
}
