// ---- Types ----
export interface PolymarketPosition {
  id: string;
  title: string;
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
  cashPnl?: number;
  percentPnl?: number;
}

export interface PolymarketTrade {
  id: string;
  title: string;
  side: string;
  outcome: string;
  outcomeIndex: number;
  conditionId: string;
  size: number;
  price: number;
  timestamp: number;
  transactionHash: string;
  name: string;
  slug: string;
}

export interface TraderProfile {
  address: string;
  name: string;
  pseudonym: string;
  profileImage: string;
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
  _exposure?: Record<string, number>;
}

export type ChartPeriod = '24h' | '7d' | '30d' | 'all';

// ---- API ----
const API = 'https://data-api.polymarket.com';

// In-memory cache for closed positions
const cacheMap = new Map<string, { data: any[]; ts: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 min

function getCacheKey(user: string, ep: string) {
  return `pm_${ep}_${user}`;
}

function getCached(address: string, ep: string): any[] | null {
  const entry = cacheMap.get(getCacheKey(address, ep));
  if (entry && Date.now() - entry.ts < CACHE_TTL) return entry.data;
  return null;
}

function setCache(address: string, ep: string, data: any[]) {
  cacheMap.set(getCacheKey(address, ep), { data, ts: Date.now() });
}

export function clearCache(address: string) {
  for (const key of cacheMap.keys()) {
    if (key.endsWith(address)) cacheMap.delete(key);
  }
}

async function fetchPaginated(endpoint: string, user: string, cached = true): Promise<any[]> {
  if (cached) {
    const c = getCached(user, endpoint);
    if (c) return c;
  }

  let all: any[] = [];
  let offset = 0;
  for (let page = 0; page < 40; page++) {
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
    } catch { break; }
  }
  if (cached) setCache(user, endpoint, all);
  return all;
}

// ---- Trader Lookup (just check if address has any activity) ----
export async function lookupTrader(address: string): Promise<TraderProfile> {
  try {
    const res = await fetch(`${API}/trades?user=${address}&limit=1`);
    if (!res.ok) return { address, name: '', pseudonym: '', profileImage: '' };
    const data = await res.json();
    const items = Array.isArray(data) ? data : (data.trades || []);
    if (!items.length) return { address, name: '', pseudonym: '', profileImage: '' };
    const t = items[0];
    return {
      address,
      name: t.name || '',
      pseudonym: t.pseudonym || '',
      profileImage: t.profileImageOptimized || t.profileImage || '',
    };
  } catch { return { address, name: '', pseudonym: '', profileImage: '' }; }
}

// ---- Real-Time Trades Feed ----
export async function fetchRecentClosedPositions(
  address: string,
  limit = 20,
  afterTs?: number,
): Promise<any[]> {
  let url = `${API}/closed-positions?user=${address}&limit=${limit}&sortBy=TIMESTAMP&sortDirection=DESC`;
  if (afterTs) url += `&after_timestamp=${afterTs}`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data) ? data : (data.positions || data.data || []);
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
    if (ts > lastTradeTs) lastTradeTs = ts;
    if (pnl > 0) { wins++; biggestWin = Math.max(biggestWin, pnl); }
    else if (pnl < 0) { losses++; biggestLoss = Math.min(biggestLoss, pnl); }
    pnlAll += pnl;
    if (now - ts <= 86400) pnl24 += pnl;
    if (now - ts <= 604800) pnl7 += pnl;
    if (now - ts <= 2592000) pnl30 += pnl;
  }

  const total = wins + losses;
  return {
    realizedPnl24h: parseFloat(pnl24.toFixed(2)),
    realizedPnl7d: parseFloat(pnl7.toFixed(2)),
    realizedPnl30d: parseFloat(pnl30.toFixed(2)),
    realizedPnlAll: parseFloat(pnlAll.toFixed(2)),
    totalTrades: total, wins, losses,
    winRate: total > 0 ? parseFloat(((wins / total) * 100).toFixed(1)) : 0,
    avgPnlPerTrade: total > 0 ? parseFloat((pnlAll / total).toFixed(2)) : 0,
    biggestWin: parseFloat(biggestWin.toFixed(2)),
    biggestLoss: parseFloat(biggestLoss.toFixed(2)),
    lastTradeTs,
  };
}

export async function getTraderOpenPositions(address: string): Promise<PolymarketPosition[]> {
  const positions = await fetchPaginated('positions', address);
  return positions.filter((p: any) => p.size > 0).map((p: any) => ({
    id: `${p.conditionId || 'pos'}-${p.outcomeIndex ?? ''}`,
    title: p.title || 'Unknown',
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
    cashPnl: p.cashPnl,
    percentPnl: p.percentPnl,
  }));
}

export async function getTraderClosedPositions(address: string, limit = 100): Promise<PolymarketPosition[]> {
  const positions = await fetchPaginated('closed-positions', address);
  return positions.slice(0, limit).map((p: any) => ({
    id: `${p.conditionId || 'cls'}-${p.timestamp || ''}`,
    title: p.title || 'Unknown',
    outcomeIndex: p.outcomeIndex ?? -1,
    conditionId: p.conditionId || '',
    size: p.totalBought || 0,
    avgPrice: p.avgPrice || 0,
    realizedPnl: p.realizedPnl || 0,
    unrealizedPnl: 0,
    timestamp: p.timestamp || 0,
    closed: true,
    imageUrl: p.icon || '',
  }));
}

export async function getTraderPerfData(
  address: string,
  period: ChartPeriod = 'all',
): Promise<{ time: number; value: number; dateStr: string }[]> {
  const positions = await fetchPaginated('closed-positions', address);
  positions.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

  const now = Math.floor(Date.now() / 1000);
  const window = period === '24h' ? 86400 : period === '7d' ? 604800 : period === '30d' ? 2592000 : Infinity;

  let cumulative = 0;
  const data: { time: number; value: number; dateStr: string }[] = [];

  for (const p of positions) {
    const ts = p.timestamp || 0;
    if (now - ts > window) continue;
    cumulative += p.realizedPnl || 0;
    const d = new Date(ts * 1000);
    data.push({
      time: ts * 1000,
      value: parseFloat(cumulative.toFixed(2)),
      dateStr: period === '24h'
        ? d.toLocaleTimeString('en-GB', { timeZone: 'Europe/Vilnius', hour: '2-digit', minute: '2-digit' })
        : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
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
  tradeLimit?: number,
): Promise<SimResult> {
  const positions = await fetchPaginated('closed-positions', address);
  positions.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

  let limited = positions;
  if (tradeLimit && tradeLimit > 0 && tradeLimit < positions.length) {
    limited = positions.slice(-tradeLimit);
  }

  let balance = initialBalance;
  const marketExposure: Record<string, number> = {};
  const trades: SimTrade[] = [];
  const perfData: { time: number; value: number; dateStr: string }[] = [];
  let wins = 0, losses = 0;

  for (const p of limited) {
    const mKey = p.conditionId || `pos-${trades.length}`;
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

    if (profit > 0) wins++; else if (profit < 0) losses++;

    const d = new Date(ts * 1000);
    const dateStr = d.toLocaleDateString('en-GB', {
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
    });

    trades.push({
      id: `sim-${trades.length}`,
      title: p.title || 'Unknown',
      side, amount: tradeAmount,
      roi: parseFloat(roiPct.toFixed(1)),
      profit: parseFloat(profit.toFixed(2)),
      balanceAfter: parseFloat(balance.toFixed(2)),
      time: ts, dateStr,
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
    pnl24h: parseFloat(pnl24.toFixed(2)), pnl7d: parseFloat(pnl7.toFixed(2)),
    pnl30d: parseFloat(pnl30.toFixed(2)), pnlAll: parseFloat(pnlAll.toFixed(2)),
    totalTrades: total, wins, losses,
    winRate: total > 0 ? parseFloat(((wins / total) * 100).toFixed(1)) : 0,
    trades, perfData,
  };
}

// ---- Live Copy Trading ----
export function applyLiveTrade(
  cp: { conditionId?: string; title?: string; outcomeIndex?: number; totalBought?: number; realizedPnl?: number; timestamp?: number },
  liveState: LiveState,
  tradeAmount: number,
  maxPerMarket: number,
): boolean {
  const mKey = cp.conditionId || `live-${liveState.trades.length}`;
  const side = cp.outcomeIndex === 0 ? 'YES' : 'NO';
  const roiPct = cp.totalBought && cp.totalBought > 0
    ? (cp.realizedPnl! / cp.totalBought) * 100 : 0;
  const exposure = liveState._exposure?.[mKey] || 0;
  if (exposure >= maxPerMarket || liveState.balance < tradeAmount) return false;

  liveState._exposure = liveState._exposure || {};
  liveState._exposure[mKey] = exposure + tradeAmount;
  const profit = tradeAmount * (roiPct / 100);
  liveState.balance += profit;
  liveState._exposure[mKey] = Math.max(0, liveState._exposure[mKey] - tradeAmount);

  if (profit > 0) liveState.totalWins++;
  else if (profit < 0) liveState.totalLosses++;

  const ts = cp.timestamp || 0;
  const d = new Date(ts * 1000);
  const dateStr = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

  liveState.trades.push({
    id: `live-${liveState.trades.length}`,
    title: cp.title || 'Unknown', side, amount: tradeAmount,
    roi: parseFloat(roiPct.toFixed(1)), profit: parseFloat(profit.toFixed(2)),
    balanceAfter: parseFloat(liveState.balance.toFixed(2)), time: ts, dateStr,
  });
  return true;
}

export function getLiveStats(ls: LiveState) {
  const now = Date.now() / 1000;
  const total = ls.totalWins + ls.totalLosses;
  const pnlAll = ls.trades.reduce((s, t) => s + t.profit, 0);
  const pnl24 = ls.trades.filter(t => now - t.time <= 86400).reduce((s, t) => s + t.profit, 0);
  const pnl7 = ls.trades.filter(t => now - t.time <= 604800).reduce((s, t) => s + t.profit, 0);
  const pnl30 = ls.trades.filter(t => now - t.time <= 2592000).reduce((s, t) => s + t.profit, 0);
  return {
    balance: parseFloat(ls.balance.toFixed(2)),
    pnl24h: parseFloat(pnl24.toFixed(2)), pnl7d: parseFloat(pnl7.toFixed(2)),
    pnl30d: parseFloat(pnl30.toFixed(2)), pnlAll: parseFloat(pnlAll.toFixed(2)),
    totalTrades: total, wins: ls.totalWins, losses: ls.totalLosses,
    winRate: total > 0 ? parseFloat(((ls.totalWins / total) * 100).toFixed(1)) : 0,
  };
}
