// ---- Types ----
export interface PolymarketPosition {
  id: string;
  market: string;
  title: string;
  outcome: string;
  outcomeIndex: number;
  conditionId: string;
  size: number;
  avgPrice: number;
  realizedPnl: number;
  unrealizedPnl: number;
  timestamp: number;
  closed: boolean;
  currentPrice?: number;
  imageUrl?: string;
  currentValue?: number;
  cashPnl?: number;
  percentPnl?: number;
  redeemable?: boolean;
}

export interface TraderStats {
  realizedPnl24h: number;
  realizedPnl7d: number;
  realizedPnl30d: number;
  realizedPnlAll: number;
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  avgPnlPerTrade: number;
  biggestWin: number;
  biggestLoss: number;
  lastTradeTs: number;
}

export interface SimResult {
  balance: number;
  pnl24h: number;
  pnl7d: number;
  pnl30d: number;
  pnlAll: number;
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  trades: SimTrade[];
  openPositions: SimOpenPos[];
  perfData: { time: number; value: number; dateStr: string }[];
}

export interface SimTrade {
  id: string;
  title: string;
  side: 'YES' | 'NO';
  amount: number;
  roi: number;
  profit: number;
  balanceAfter: number;
  time: number;
  dateStr: string;
}

export interface SimOpenPos {
  market: string;
  side: 'YES' | 'NO';
  amount: number;
  avgPrice: number;
  currentPrice: number;
  unrealizedPnl: number;
}

export interface LiveTrade {
  id: string;
  title: string;
  side: 'YES' | 'NO';
  amount: number;
  roi: number;
  profit: number;
  balanceAfter: number;
  time: number;
  dateStr: string;
}

export interface LiveState {
  balance: number;
  trades: LiveTrade[];
  totalWins: number;
  totalLosses: number;
}

// ---- API ----
const API = 'https://data-api.polymarket.com';

// Cache for closed positions (avoids 2000-item refetch)
const cacheKey = (u: string) => `pm_closed_${u}`;
const CACHE_TTL = 300_000; // 5 minutes

interface CacheEntry {
  data: any[];
  ts: number;
}

function getCached(address: string): any[] | null {
  try {
    const raw = localStorage.getItem(cacheKey(address));
    if (!raw) return null;
    const e: CacheEntry = JSON.parse(raw);
    if (Date.now() - e.ts > CACHE_TTL) return null;
    return e.data;
  } catch { return null; }
}

function setCache(address: string, data: any[]) {
  localStorage.setItem(cacheKey(address), JSON.stringify({ data, ts: Date.now() }));
}

function clearCache(address: string) {
  localStorage.removeItem(cacheKey(address));
}

export { clearCache };

async function fetchPaginated(endpoint: string, user: string, cached = true): Promise<any[]> {
  if (cached && endpoint === 'closed-positions') {
    const cached = getCached(user);
    if (cached) return cached;
  }

  let all: any[] = [];
  let offset = 0;
  const maxPages = 40;
  let page = 0;
  while (page < maxPages) {
    const url = `${API}/${endpoint}?user=${user}&limit=50&offset=${offset}&sortBy=TIMESTAMP&sortDirection=DESC`;
    try {
      const res = await fetch(url);
      if (!res.ok) break;
      const data = await res.json();
      const items = Array.isArray(data) ? data : (data.trades || data.data || []);
      if (!items.length) break;
      all = all.concat(items);
      if (items.length < 50) break;
      offset += 50;
      page++;
    } catch { break; }
  }

  if (cached && endpoint === 'closed-positions') setCache(user, all);
  return all;
}

// ---- Trader Data ----
export async function getTraderStats(address: string): Promise<TraderStats> {
  const positions = await fetchPaginated('closed-positions', address);
  const now = Date.now() / 1000;
  
  let pnl24 = 0, pnl7 = 0, pnl30 = 0, pnlAll = 0;
  let wins = 0, losses = 0, biggestWin = 0, biggestLoss = 0;
  let lastTradeTs = 0;

  for (const p of positions) {
    const pnl = p.realizedPnl || 0;
    const ts = p.timestamp || 0;
    const age = now - ts;

    if (ts > lastTradeTs) lastTradeTs = ts;

    if (pnl > 0) { wins++; biggestWin = Math.max(biggestWin, pnl); }
    else if (pnl < 0) { losses++; biggestLoss = Math.min(biggestLoss, pnl); }
    
    pnlAll += pnl;
    if (age <= 86400) pnl24 += pnl;
    if (age <= 604800) pnl7 += pnl;
    if (age <= 2592000) pnl30 += pnl;
  }

  const total = wins + losses;
  return {
    realizedPnl24h: parseFloat(pnl24.toFixed(2)),
    realizedPnl7d: parseFloat(pnl7.toFixed(2)),
    realizedPnl30d: parseFloat(pnl30.toFixed(2)),
    realizedPnlAll: parseFloat(pnlAll.toFixed(2)),
    totalTrades: total,
    wins,
    losses,
    winRate: total > 0 ? parseFloat(((wins / total) * 100).toFixed(1)) : 0,
    avgPnlPerTrade: total > 0 ? parseFloat((pnlAll / total).toFixed(2)) : 0,
    biggestWin: parseFloat(biggestWin.toFixed(2)),
    biggestLoss: parseFloat(biggestLoss.toFixed(2)),
    lastTradeTs,
  };
}

export async function getTraderOpenPositions(address: string): Promise<PolymarketPosition[]> {
  const positions = await fetchPaginated('positions', address);
  return positions
    .filter((p: any) => p.size > 0)
    .map((p: any) => ({
      id: `${p.conditionId || 'pos'}-${p.outcomeIndex ?? ''}`,
      market: p.slug || p.market_slug || p.conditionId || 'Unknown',
      title: p.title || 'Unknown Market',
      outcome: p.outcome || (p.outcomeIndex === 0 ? 'YES' : 'NO'),
      outcomeIndex: p.outcomeIndex ?? -1,
      conditionId: p.conditionId || '',
      size: p.size || 0,
      avgPrice: p.avgPrice || 0,
      realizedPnl: p.realizedPnl || 0,
      unrealizedPnl: p.cashPnl || 0,
      timestamp: p.timestamp || 0,
      closed: false,
      currentPrice: p.curPrice || 0,
      imageUrl: p.icon || '',
      currentValue: p.currentValue,
      cashPnl: p.cashPnl,
      percentPnl: p.percentPnl,
      redeemable: p.redeemable,
    }));
}

export async function getTraderClosedPositions(address: string, limit = 100): Promise<PolymarketPosition[]> {
  const positions = await fetchPaginated('closed-positions', address, true);
  return positions.slice(0, limit).map((p: any) => ({
    id: `${p.conditionId || 'closed'}-${p.timestamp || ''}`,
    market: p.slug || p.market_slug || p.conditionId || 'Unknown',
    title: p.title || 'Unknown Market',
    outcome: p.outcome || (p.outcomeIndex === 0 ? 'YES' : 'NO'),
    outcomeIndex: p.outcomeIndex ?? -1,
    conditionId: p.conditionId || '',
    size: p.totalBought || 0,
    avgPrice: p.avgPrice || 0,
    realizedPnl: p.realizedPnl || 0,
    unrealizedPnl: 0,
    timestamp: p.timestamp || 0,
    closed: true,
    imageUrl: p.icon || '',
    currentValue: 0,
    cashPnl: 0,
    percentPnl: 0,
    redeemable: false,
  }));
}

export async function getTraderPerfData(address: string): Promise<{ time: number; value: number; dateStr: string }[]> {
  const positions = await fetchPaginated('closed-positions', address, true);
  positions.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  
  let cumulative = 0;
  const data: { time: number; value: number; dateStr: string }[] = [];
  
  for (const p of positions) {
    cumulative += p.realizedPnl || 0;
    const ts = (p.timestamp || 0) * 1000;
    data.push({
      time: ts,
      value: parseFloat(cumulative.toFixed(2)),
      dateStr: new Date(ts).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
    });
  }
  
  return data;
}

// ---- Historical Simulation ----
export async function runHistoricalSimulation(
  address: string,
  initialBalance: number,
  tradeAmount: number,
  maxPerMarket: number,
  tradeLimit?: number, // undefined = all
): Promise<SimResult> {
  const positions = await fetchPaginated('closed-positions', address, true);
  positions.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

  let limited = positions;
  if (tradeLimit && tradeLimit > 0 && tradeLimit < positions.length) {
    // Take last N trades (most recent)
    limited = positions.slice(-tradeLimit);
  }

  let balance = initialBalance;
  const marketExposure: Record<string, number> = {};
  const trades: SimTrade[] = [];
  const perfData: { time: number; value: number; dateStr: string }[] = [];
  let wins = 0, losses = 0;

  for (const p of limited) {
    const mKey = p.conditionId || JSON.stringify(p);
    const side = p.outcomeIndex === 0 ? 'YES' : 'NO';
    const roiPct = p.totalBought && p.totalBought > 0
      ? (p.realizedPnl / p.totalBought) * 100 : 0;
    const exposure = marketExposure[mKey] || 0;
    const ts = p.timestamp || 0;

    if (exposure >= maxPerMarket || balance < tradeAmount) continue;

    marketExposure[mKey] = exposure + tradeAmount;
    const profit = tradeAmount * (roiPct / 100);
    balance += profit;
    marketExposure[mKey] = Math.max(0, (marketExposure[mKey] || 0) - tradeAmount);

    if (profit > 0) wins++;
    else if (profit < 0) losses++;

    const d = new Date(ts * 1000);
    const dateStr = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

    trades.push({
      id: `${p.id || ''}-${trades.length}`,
      title: p.title || 'Unknown Market',
      side,
      amount: tradeAmount,
      roi: parseFloat(roiPct.toFixed(1)),
      profit: parseFloat(profit.toFixed(2)),
      balanceAfter: parseFloat(balance.toFixed(2)),
      time: ts,
      dateStr,
    });

    perfData.push({
      time: ts * 1000,
      value: parseFloat(balance.toFixed(2)),
      dateStr: d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
    });
  }

  const now = Date.now() / 1000;
  const total = wins + losses;
  const pnl24 = trades.filter(t => now - t.time <= 86400).reduce((s, t) => s + t.profit, 0);
  const pnl7 = trades.filter(t => now - t.time <= 604800).reduce((s, t) => s + t.profit, 0);
  const pnl30 = trades.filter(t => now - t.time <= 2592000).reduce((s, t) => s + t.profit, 0);
  const pnlAll = trades.reduce((s, t) => s + t.profit, 0);

  return {
    balance: parseFloat(balance.toFixed(2)),
    pnl24h: parseFloat(pnl24.toFixed(2)),
    pnl7d: parseFloat(pnl7.toFixed(2)),
    pnl30d: parseFloat(pnl30.toFixed(2)),
    pnlAll: parseFloat(pnlAll.toFixed(2)),
    totalTrades: total,
    wins,
    losses,
    winRate: total > 0 ? parseFloat(((wins / total) * 100).toFixed(1)) : 0,
    trades,
    openPositions: [],
    perfData,
  };
}

// ---- Live Copy Trade (called when new trades detected) ----
export function applyLiveTrade(
  position: any, // raw API position
  liveState: LiveState,
  tradeAmount: number,
  maxPerMarket: number,
): LiveTrade | null {
  const mKey = position.conditionId || JSON.stringify(position);
  const side = position.outcomeIndex === 0 ? 'YES' : 'NO';
  const roiPct = position.totalBought && position.totalBought > 0
    ? (position.realizedPnl / position.totalBought) * 100 : 0;
  
  // Track live exposure per market (stored in liveState, caller manages it)
  const exposure = (liveState as any)._exposure?.[mKey] || 0;
  if (exposure >= maxPerMarket || liveState.balance < tradeAmount) return null;

  (liveState as any)._exposure = (liveState as any)._exposure || {};
  ((liveState as any)._exposure as Record<string, number>)[mKey] = exposure + tradeAmount;

  const profit = tradeAmount * (roiPct / 100);
  liveState.balance += profit;
  ((liveState as any)._exposure as Record<string, number>)[mKey] = Math.max(0, 
    ((liveState as any)._exposure as Record<string, number>)[mKey] - tradeAmount);

  if (profit > 0) liveState.totalWins++;
  else if (profit < 0) liveState.totalLosses++;

  const ts = position.timestamp || 0;
  const d = new Date(ts * 1000);
  const dateStr = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

  const trade: LiveTrade = {
    id: `${position.id || ''}-${liveState.trades.length}`,
    title: position.title || 'Unknown Market',
    side,
    amount: tradeAmount,
    roi: parseFloat(roiPct.toFixed(1)),
    profit: parseFloat(profit.toFixed(2)),
    balanceAfter: parseFloat(liveState.balance.toFixed(2)),
    time: ts,
    dateStr,
  };

  liveState.trades.push(trade);
  return trade;
}

export function getLiveStats(liveState: LiveState) {
  const total = liveState.totalWins + liveState.totalLosses;
  const now = Date.now() / 1000;
  const pnlAll = liveState.trades.reduce((s, t) => s + t.profit, 0);
  const pnl24 = liveState.trades.filter(t => now - t.time <= 86400).reduce((s, t) => s + t.profit, 0);
  const pnl7 = liveState.trades.filter(t => now - t.time <= 604800).reduce((s, t) => s + t.profit, 0);
  const pnl30 = liveState.trades.filter(t => now - t.time <= 2592000).reduce((s, t) => s + t.profit, 0);

  return {
    balance: parseFloat(liveState.balance.toFixed(2)),
    pnl24h: parseFloat(pnl24.toFixed(2)),
    pnl7d: parseFloat(pnl7.toFixed(2)),
    pnl30d: parseFloat(pnl30.toFixed(2)),
    pnlAll: parseFloat(pnlAll.toFixed(2)),
    totalTrades: total,
    wins: liveState.totalWins,
    losses: liveState.totalLosses,
    winRate: total > 0 ? parseFloat(((liveState.totalWins / total) * 100).toFixed(1)) : 0,
  };
}
