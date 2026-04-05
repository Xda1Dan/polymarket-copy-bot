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

// ---- API Helper ----
const API = 'https://data-api.polymarket.com';

async function fetchPaginated(endpoint: string, user: string): Promise<any[]> {
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
  return all;
}

// ---- Trader Data ----
export async function getTraderStats(address: string): Promise<TraderStats> {
  const positions = await fetchPaginated('closed-positions', address);
  const now = Date.now() / 1000;
  
  let pnl24 = 0, pnl7 = 0, pnl30 = 0, pnlAll = 0;
  let wins = 0, losses = 0, biggestWin = 0, biggestLoss = 0;

  for (const p of positions) {
    const pnl = p.realizedPnl || 0;
    const ts = p.timestamp || 0;
    const age = now - ts;

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
  };
}

export async function getTraderOpenPositions(address: string): Promise<PolymarketPosition[]> {
  const positions = await fetchPaginated('positions', address);
  return positions
    .filter((p: any) => p.size > 0)
    .map((p: any) => ({
      id: p.id || `pos-${Math.random()}`,
      market: p.market_slug || p.conditionId || 'Unknown',
      title: p.title || 'Unknown Market',
      outcome: p.outcome || '',
      outcomeIndex: p.outcomeIndex ?? -1,
      conditionId: p.conditionId || '',
      size: p.size || 0,
      avgPrice: p.avgPrice || 0,
      realizedPnl: p.realizedPnl || 0,
      unrealizedPnl: p.unrealizedPnl || 0,
      timestamp: p.timestamp || 0,
      closed: false,
      currentPrice: p.currentPrice || 0,
      imageUrl: p.image || '',
    }));
}

export async function getTraderClosedPositions(address: string, limit = 100): Promise<PolymarketPosition[]> {
  const positions = await fetchPaginated('closed-positions', address);
  return positions.slice(0, limit).map((p: any) => ({
    id: p.id || `closed-${Math.random()}`,
    market: p.market_slug || p.conditionId || 'Unknown',
    title: p.title || 'Unknown Market',
    outcome: p.outcome || '',
    outcomeIndex: p.outcomeIndex ?? -1,
    conditionId: p.conditionId || '',
    size: p.totalBought || 0,
    avgPrice: p.avgPrice || 0,
    realizedPnl: p.realizedPnl || 0,
    unrealizedPnl: 0,
    timestamp: p.timestamp || 0,
    closed: true,
  }));
}

// Build cumulative PnL chart data from closed positions
export async function getTraderPerfData(address: string): Promise<{ time: number; value: number; dateStr: string }[]> {
  const positions = await fetchPaginated('closed-positions', address);
  // Sort oldest first
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

// ---- Our Simulation ----
export async function runSimulation(
  address: string,
  initialBalance: number,
  tradeAmount: number,
  maxPerMarket: number
): Promise<SimResult> {
  const positions = await fetchPaginated('closed-positions', address);
  // Sort oldest first for correct replay
  positions.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

  let balance = initialBalance;
  const marketExposure: Record<string, number> = {};
  const trades: SimTrade[] = [];
  const perfData: { time: number; value: number; dateStr: string }[] = [{
    time: 0, value: initialBalance, dateStr: 'start',
  }];
  const now = Date.now() / 1000;
  let wins = 0, losses = 0;

  for (const p of positions) {
    const mKey = p.conditionId || p.market_slug || JSON.stringify(p);
    const side = p.outcomeIndex === 0 ? 'YES' : 'NO';
    const roiPct = p.totalBought && p.totalBought > 0 && p.realizedPnl !== undefined
      ? (p.realizedPnl / p.totalBought) * 100 : 0;
    const exposure = marketExposure[mKey] || 0;
    const ts = p.timestamp || 0;
    const age = now - ts;

    if (exposure >= maxPerMarket || balance < tradeAmount) continue;

    balance -= tradeAmount;
    marketExposure[mKey] = exposure + tradeAmount;

    const profit = tradeAmount * (roiPct / 100);
    balance += profit;
    marketExposure[mKey] = Math.max(0, (marketExposure[mKey] || 0) - tradeAmount);

    if (profit > 0) wins++; else if (profit < 0) losses++;

    const d = new Date(ts * 1000);
    const dateStr = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

    trades.push({
      id: p.id || `sim-${trades.length}`,
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
    openPositions: [], // Sim only tracks closed
    perfData,
  };
}
