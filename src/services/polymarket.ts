// ================================================================
// Polymarket Data API — client service
// ================================================================
// Base: https://data-api.polymarket.com
// All endpoints are public (no auth needed)
//
// Key endpoints:
//   GET /closed-positions?user=&limit=&offset=&sortBy=TIMESTAMP
//   GET /positions?user=&limit=...       (NO sort params supported!)
//   GET /trades?user=&limit=&after_timestamp=&side=BUY
//   GET /activity?user=&limit=&after_timestamp=
//   GET /leaderboard/rankings - top traders
//
// WebSocket (ws-subscriptions-clob.polymarket.com/ws/market)
//   Streams market-level data (orderbook, last_trade_price) by asset_id.
//   Cannot filter by user address. Requires knowing every token_id upfront.
//   NOT usable for "watch this trader" use case without subscribing to
//   500+ active token_ids — impractical and hits connection limits.
//
// Real-time tracking of another trader = poll /closed-positions?after_timestamp at 3-5s
// ================================================================

export type ChartPeriod = '24h' | '7d' | '30d' | 'all';

// ---- Raw types ----
export interface RawClosedPosition {
  conditionId: string;
  title: string;
  slug: string;
  icon: string;
  outcome: string;
  outcomeIndex: number;
  avgPrice: number;
  totalBought: number;
  realizedPnl: number;
  curPrice: number;
  timestamp: number;
  endDate: string;
}

export interface RawOpenPosition {
  conditionId: string;
  title: string;
  slug: string;
  icon: string;
  outcome: string;
  outcomeIndex: number;
  avgPrice: number;
  size: number;
  totalBought: number;
  realizedPnl: number;
  unrealizedPnl?: number;
  cashPnl?: number;
  curPrice: number;
  currentValue: number;
  percentPnl: number;
  timestamp: number;
  redeemable: boolean;
}

export interface RawTrade {
  proxyWallet: string;
  side: string;
  asset: string;
  conditionId: string;
  size: number;
  price: number;
  timestamp: number;
  title: string;
  slug: string;
  icon: string;
  eventSlug: string;
  outcome: string;
  outcomeIndex: number;
  name: string;
  pseudonym: string;
  profileImage: string;
  profileImageOptimized: string;
  transactionHash: string;
}

// ---- Clean types ----
export interface TraderStats {
  realizedPnl24h: number;
  realizedPnl7d: number;
  realizedPnl30d: number;
  realizedPnlAll: number;
  totalTrades: number;
  wins: number;
  losses: number;
  breakeven: number;
  winRate: number;
  avgPnlPerTrade: number;
  biggestWin: number;
  biggestLoss: number;
  lastTradeTs: number;
}

export interface PerfPoint {
  time: number;
  value: number;
  dateStr: string;
  ts: number;
}

export interface SimResult {
  balance: number;
  trades: SimTrade[];
  perfData: PerfPoint[];
  stats: { totalTrades: number; wins: number; losses: number; winRate: number; pnlAll: number };
}

export interface SimTrade {
  id: string;
  title: string;
  side: 'YES' | 'NO';
  amount: number;
  roi: number;
  profit: number;
  balanceAfter: number;
  timeS: number;
  dateStr: string;
}

export interface OpenPosition {
  id: string;
  title: string;
  icon: string;
  side: string;
  size: number;
  avgPrice: number;
  currentPrice: number;
  cashPnl: number;
  percentPnl: number;
  currentValue: number;
  redeemable: boolean;
}

export interface ClosedPosition {
  id: string;
  title: string;
  icon: string;
  side: string;
  size: number;
  avgPrice: number;
  realizedPnl: number;
  timestamp: number;
  dateStr: string;
}

// ---- HTTP helpers ----
const BASE = 'https://data-api.polymarket.com';

async function getJson(url: string): Promise<any> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
}

/**
 * Fetch paginated data from a Polymarket endpoint.
 * @param sortable — if true, adds sortBy/sortDirection params.
 *   `/closed-positions` supports sorting. `/positions` does NOT.
 */
async function fetchPaginated(endpoint: string, user: string, sortable = false): Promise<any[]> {
  let all: any[] = [];
  let offset = 0;
  for (let page = 0; page < 40; page++) {
    let url = `${BASE}/${endpoint}?user=${user}&limit=50&offset=${offset}`;
    if (sortable) url += `&sortBy=TIMESTAMP&sortDirection=DESC`;
    const data = await getJson(url);
    const items = Array.isArray(data) ? data : [];
    if (!items.length) break;
    all = all.concat(items);
    if (items.length < 50) break;
    offset += 50;
  }
  return all;
}

// ---- Caching ----
interface CacheEntry<T> { data: T; ts: number; }
const _cache = new Map<string, CacheEntry<any>>();
const TTL_5M = 300_000;

function cached<T>(key: string, fn: () => Promise<T>, ttl = TTL_5M): Promise<T> {
  const hit = _cache.get(key);
  if (hit && Date.now() - hit.ts < ttl) return Promise.resolve(hit.data);
  return fn().then(d => { _cache.set(key, { data: d, ts: Date.now() }); return d; });
}

export function cacheKey(user: string) { return `closed_${user}`; }
export function invalidateCache(user: string) {
  for (const k of _cache.keys()) { if (k.includes(user)) _cache.delete(k); }
}

// ---- Public API ----

export async function fetchClosedPositions(user: string, useCached = true): Promise<RawClosedPosition[]> {
  const key = `closed_${user}`;
  if (useCached) {
    return cached(key, () => fetchPaginated('closed-positions', user, true));
  }
  return fetchPaginated('closed-positions', user, true);
}

export async function fetchOpenPositions(user: string): Promise<RawOpenPosition[]> {
  // /positions does NOT support sortBy params!
  const positions = await fetchPaginated('positions', user, false);
  return positions.filter((p: any) => p.size && p.size > 0);
}

export async function fetchRecentTrades(user: string, afterTs?: number): Promise<RawTrade[]> {
  let url = `${BASE}/trades?user=${user}&limit=10&sortBy=TIMESTAMP`;
  if (afterTs) url += `&after_timestamp=${afterTs}`;
  const data = await getJson(url);
  return Array.isArray(data) ? data : [];
}

export async function addressExists(user: string): Promise<boolean> {
  try {
    const data = await getJson(`${BASE}/trades?user=${user}&limit=1`);
    return Array.isArray(data) && data.length > 0;
  } catch { return false; }
}

// ---- Formatters ----

function lithuanianDate(ts: number, hours = false): string {
  const d = new Date(ts * 1000);
  const opts: Intl.DateTimeFormatOptions = hours
    ? { timeZone: 'Europe/Vilnius', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }
    : { timeZone: 'Europe/Vilnius', day: '2-digit', month: 'short' };
  return d.toLocaleDateString('en-GB', opts);
}

function sideName(outcomeIndex: number): 'YES' | 'NO' {
  return outcomeIndex === 0 ? 'YES' : 'NO';
}

// ---- Trader Stats ----
export async function getTraderStats(user: string): Promise<TraderStats> {
  const positions = await fetchClosedPositions(user);
  const now = Math.floor(Date.now() / 1000);
  
  let pnl24 = 0, pnl7 = 0, pnl30 = 0, pnlAll = 0;
  let wins = 0, losses = 0, breakeven = 0;
  let biggestWin = 0, biggestLoss = 0, lastTradeTs = 0;

  for (const p of positions) {
    const pnl = p.realizedPnl || 0;
    const ts = p.timestamp || 0;
    if (ts > lastTradeTs) lastTradeTs = ts;
    
    pnlAll += pnl;
    if (now - ts <= 86400) pnl24 += pnl;
    if (now - ts <= 604800) pnl7 += pnl;
    if (now - ts <= 2592000) pnl30 += pnl;
    
    if (pnl > 0.01) { wins++; biggestWin = Math.max(biggestWin, pnl); }
    else if (pnl < -0.01) { losses++; biggestLoss = Math.min(biggestLoss, pnl); }
    else { breakeven++; }
  }

  const total = wins + losses + breakeven;
  return {
    realizedPnl24h: +pnl24.toFixed(2),
    realizedPnl7d: +pnl7.toFixed(2),
    realizedPnl30d: +pnl30.toFixed(2),
    realizedPnlAll: +pnlAll.toFixed(2),
    totalTrades: total, wins, losses, breakeven,
    winRate: total > 0 ? +((wins / total) * 100).toFixed(1) : 0,
    avgPnlPerTrade: total > 0 ? +(pnlAll / total).toFixed(2) : 0,
    biggestWin: +biggestWin.toFixed(2),
    biggestLoss: +biggestLoss.toFixed(2),
    lastTradeTs,
  };
}

// ---- Cumulative PnL Chart Data ----
export async function getPerfData(user: string, period: ChartPeriod): Promise<PerfPoint[]> {
  const positions = await fetchClosedPositions(user);
  positions.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

  const now = Math.floor(Date.now() / 1000);
  const window = period === '24h' ? 86400 : period === '7d' ? 604800 : period === '30d' ? 2592000 : Infinity;

  let cumulative = 0;
  const data: PerfPoint[] = [];

  for (const p of positions) {
    const ts = p.timestamp || 0;
    if (now - ts > window) continue;
    cumulative += p.realizedPnl || 0;
    
    const hrs = period === '24h';
    data.push({
      time: ts * 1000,
      value: +cumulative.toFixed(2),
      dateStr: hrs
        ? new Date(ts * 1000).toLocaleTimeString('en-GB', { timeZone: 'Europe/Vilnius', hour: '2-digit', minute: '2-digit' })
        : new Date(ts * 1000).toLocaleDateString('en-GB', { timeZone: 'Europe/Vilnius', day: '2-digit', month: 'short' }),
      ts,
    });
  }

  return data;
}

// ---- Position Lists ----
export async function getPositionsList(user: string): Promise<OpenPosition[]> {
  const raw = await fetchOpenPositions(user);
  return raw.map((p: any) => ({
    id: `${p.conditionId}-${p.outcomeIndex}`,
    title: p.title || 'Unknown',
    icon: p.icon || '',
    side: sideName(p.outcomeIndex),
    size: p.size || 0,
    avgPrice: p.avgPrice || 0,
    currentPrice: p.curPrice || 0,
    cashPnl: +(p.cashPnl || 0),
    percentPnl: +(p.percentPnl || 0),
    currentValue: +(p.currentValue || 0),
    redeemable: !!p.redeemable,
  }));
}

export async function getClosedList(user: string, limit = 100): Promise<ClosedPosition[]> {
  const raw = await fetchClosedPositions(user);
  return raw.slice(0, limit).map((p: any) => ({
    id: `${p.conditionId}-${p.timestamp}`,
    title: p.title || 'Unknown',
    icon: p.icon || '',
    side: sideName(p.outcomeIndex),
    size: +(p.totalBought || 0),
    avgPrice: p.avgPrice || 0,
    realizedPnl: +(p.realizedPnl || 0),
    timestamp: p.timestamp || 0,
    dateStr: lithuanianDate(p.timestamp, true),
  }));
}

// ---- Historical Simulation ----
export async function simulateHistory(
  user: string,
  initialBalance: number,
  tradeAmount: number,
  maxPerMarket: number,
  tradeLimit?: number,
): Promise<SimResult> {
  const positions = await fetchClosedPositions(user);
  positions.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

  let limited = positions;
  if (tradeLimit && tradeLimit > 0 && tradeLimit < positions.length) {
    limited = positions.slice(-tradeLimit);
  }

  let balance = initialBalance;
  const exposure: Record<string, number> = {};
  const trades: SimTrade[] = [];
  const perf: PerfPoint[] = [];
  let wins = 0, losses = 0;

  for (const p of limited) {
    const key = p.conditionId || `x${trades.length}`;
    const roi = p.totalBought > 0 ? (p.realizedPnl / p.totalBought) * 100 : 0;
    const exp = exposure[key] || 0;
    if (exp >= maxPerMarket || balance < tradeAmount) continue;

    exposure[key] = exp + tradeAmount;
    const profit = tradeAmount * (roi / 100);
    balance += profit;
    exposure[key] = Math.max(0, exposure[key] - tradeAmount);

    if (profit > 0.001) wins++;
    else if (profit < -0.001) losses++;

    const ts = p.timestamp || 0;
    const d = new Date(ts * 1000);
    const dateStr = d.toLocaleDateString('en-GB', { timeZone: 'Europe/Vilnius', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

    trades.push({
      id: `sim${trades.length}`,
      title: p.title || '?',
      side: sideName(p.outcomeIndex),
      amount: tradeAmount,
      roi: +roi.toFixed(1),
      profit: +profit.toFixed(2),
      balanceAfter: +balance.toFixed(2),
      timeS: ts,
      dateStr,
    });

    perf.push({
      time: ts * 1000,
      value: +balance.toFixed(2),
      dateStr: d.toLocaleDateString('en-GB', { timeZone: 'Europe/Vilnius', day: '2-digit', month: 'short' }),
      ts,
    });
  }

  return {
    balance: +balance.toFixed(2),
    trades,
    perfData: perf,
    stats: {
      totalTrades: wins + losses,
      wins, losses,
      winRate: (wins + losses) > 0 ? +((wins / (wins + losses)) * 100).toFixed(1) : 0,
      pnlAll: +trades.reduce((s, t) => s + t.profit, 0).toFixed(2),
    },
  };
}

export function clearCache(user: string) { invalidateCache(user); }

export type PolymarketPosition = OpenPosition;

export interface LiveState {
  balance: number;
  trades: SimTrade[];
  totalWins: number;
  totalLosses: number;
  _exposure: Record<string, number>;
}

export function getLiveStats(live: LiveState) {
  const trades = live.trades;
  const wins = trades.filter(t => t.profit > 0.001).length;
  const losses = trades.filter(t => t.profit < -0.001).length;
  const pnlAll = trades.reduce((s, t) => s + t.profit, 0);
  const now = Date.now() / 1000;
  const pnl24h = trades.filter(t => now - t.timeS < 86400).reduce((s, t) => s + t.profit, 0);
  return {
    balance: live.balance,
    pnlAll: +pnlAll.toFixed(2),
    pnl24h: +pnl24h.toFixed(2),
    totalTrades: trades.length,
    wins, losses,
    winRate: trades.length > 0 ? +((wins / trades.length) * 100).toFixed(1) : 0,
  };
}

export async function lookupTrader(address: string): Promise<{ address: string; name: string; pseudonym: string }> {
  // Try Gamma API public profile first
  try {
    const profile = await getJson(`https://gamma-api.polymarket.com/public-profile?address=${address}`);
    if (profile && profile.name) {
      return { address, name: profile.name, pseudonym: profile.pseudonym || '' };
    }
  } catch { /* ignore */ }
  // Fallback: grab pseudonym from trades
  try {
    const data = await getJson(`${BASE}/trades?user=${address}&limit=1`);
    if (Array.isArray(data) && data.length > 0) {
      return { address, name: data[0]?.pseudonym || data[0]?.name || '', pseudonym: data[0]?.pseudonym || '' };
    }
  } catch { /* ignore */ }
  return { address, name: '', pseudonym: '' };
}

export async function fetchRecentClosedPositions(user: string, limit = 20, afterTs?: number) {
  const res = await getJson(`${BASE}/closed-positions?user=${user}&limit=${limit}&sortBy=TIMESTAMP&sortDirection=DESC`);
  const items = Array.isArray(res) ? res : [];
  const filtered = afterTs ? items.filter((p: any) => (p.timestamp || 0) > afterTs) : items;
  return filtered.map((p: any) => ({
    conditionId: p.conditionId || '',
    title: p.title || '?',
    outcomeIndex: p.outcomeIndex ?? -1,
    totalBought: +(p.totalBought || 0),
    realizedPnl: +(p.realizedPnl || 0),
    timestamp: p.timestamp || 0,
  }));
}

export async function getTraderOpenPositions(user: string): Promise<OpenPosition[]> {
  return getPositionsList(user);
}

export async function getTraderClosedPositions(user: string, limit = 100): Promise<ClosedPosition[]> {
  return getClosedList(user, limit);
}

export async function getTraderPerfData(user: string, period: ChartPeriod): Promise<PerfPoint[]> {
  return getPerfData(user, period);
}

export async function runHistoricalSimulation(user: string, initial: number, tradeAmt: number, max: number, limit?: number): Promise<{
  balance: number; trades: SimTrade[]; perfData: PerfPoint[];
  totalTrades: number; wins: number; losses: number; winRate: number; pnlAll: number; pnl24h: number;
}> {
  const result = await simulateHistory(user, initial, tradeAmt, max, limit);
  const now = Date.now() / 1000;
  const pnl24h = result.trades.filter(t => now - t.timeS < 86400).reduce((s, t) => s + t.profit, 0);
  return {
    ...result,
    pnlAll: result.stats.pnlAll,
    pnl24h: +pnl24h.toFixed(2),
    totalTrades: result.stats.totalTrades,
    wins: result.stats.wins,
    losses: result.stats.losses,
    winRate: result.stats.winRate,
  };
}

// ---- Live Copy (polling) ----
// NOTE: Polymarket has NO public websocket that streams another user's trades.
// The market channel (ws-subscriptions-clob.polymarket.com/ws/market) requires
// knowing specific asset_ids (token IDs), and doesn't tell you WHO made the trade.
// The user channel requires CLOB auth keys (private, for your own account).
//
// For tracking another trader, the fastest approach is polling
// /closed-positions?user=&after_timestamp= at minimal latency.
// At 3s polling, worst-case lag is 3 seconds — sufficient for copy trading.

export async function pollNewClosedPositions(
  user: string,
  afterTs: number,
): Promise<{ conditionId: string; title: string; outcomeIndex: number; totalBought: number; realizedPnl: number; timestamp: number }[]> {
  const res = await getJson(`${BASE}/closed-positions?user=${user}&limit=10&sortBy=TIMESTAMP&sortDirection=DESC`);
  const items = Array.isArray(res) ? res : [];
  return items
    .filter((p: any) => (p.timestamp || 0) > afterTs)
    .map((p: any) => ({
      conditionId: p.conditionId || '',
      title: p.title || '?',
      outcomeIndex: p.outcomeIndex ?? -1,
      totalBought: +(p.totalBought || 0),
      realizedPnl: +(p.realizedPnl || 0),
      timestamp: p.timestamp || 0,
    }));
}

export function applyLiveTrade(
  cp: { conditionId: string; title: string; outcomeIndex: number; totalBought: number; realizedPnl: number; timestamp: number },
  state: { balance: number; trades: SimTrade[]; wins: number; losses: number; _exposure?: Record<string, number>; exposure?: Record<string, number> },
  tradeAmount: number,
  maxPerMarket: number,
): SimTrade | null {
  const exposure = state._exposure || state.exposure || {};
  const exp = exposure[cp.conditionId] || 0;
  if (exp >= maxPerMarket || state.balance < tradeAmount) return null;

  exposure[cp.conditionId] = exp + tradeAmount;
  const roi = cp.totalBought > 0 ? (cp.realizedPnl / cp.totalBought) * 100 : 0;
  const profit = +((tradeAmount * roi) / 100).toFixed(2);
  state.balance = +(state.balance + profit).toFixed(2);
  exposure[cp.conditionId] = Math.max(0, exposure[cp.conditionId] - tradeAmount);
  // Sync back
  if (state._exposure) state._exposure = exposure;
  if (state.exposure) state.exposure = exposure;

  if (profit > 0.001) state.wins++;
  else if (profit < -0.001) state.losses++;

  const ts = cp.timestamp;
  const d = new Date(ts * 1000);
  const trade: SimTrade = {
    id: `live${state.trades.length}`,
    title: cp.title || '?',
    side: sideName(cp.outcomeIndex),
    amount: tradeAmount,
    roi: +roi.toFixed(1),
    profit,
    balanceAfter: state.balance,
    timeS: ts,
    dateStr: d.toLocaleDateString('en-GB', { timeZone: 'Europe/Vilnius', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }),
  };
  state.trades.push(trade);
  return trade;
}
