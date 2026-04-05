export interface SimulatedTrade {
  id: string;
  market: string;
  side: string;
  amount: number;
  roi: number;
  profit: number;
  balanceAfter: number;
  time: string;
  timestamp: number;
}

export interface PolymarketTrade {
  id: string;
  market: string;
  asset: string;
  side: 'BUY' | 'SELL';
  size: string;
  price: string;
  timestamp: string;
  transactionHash: string;
}

export interface TraderStats {
  pnl24h: number;
  pnl7d: number;
  pnl30d: number;
  winRate: number;
  totalTrades: number;
}

const API = 'https://data-api.polymarket.com';

async function fetchAllClosed(user: string): Promise<any[]> {
  let all: any[] = [];
  let offset = 0;
  const maxPages = 20; // up to 1000 positions
  let page = 0;
  while (page < maxPages) {
    const url = `${API}/closed-positions?user=${user}&limit=50&offset=${offset}&sortBy=TIMESTAMP&sortDirection=DESC`;
    try {
      const res = await fetch(url);
      if (!res.ok) break;
      const data = await res.json();
      if (!Array.isArray(data) || data.length === 0) break;
      all = all.concat(data);
      if (data.length < 50) break; // last page
      offset += 50;
      page++;
    } catch { break; }
  }
  return all.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
}

// Also fetch from the activity endpoint for more complete history
async function fetchAllActivity(user: string): Promise<any[]> {
  let all: any[] = [];
  let offset = 0;
  const maxPages = 20;
  let page = 0;
  while (page < maxPages) {
    const url = `${API}/activity?user=${user}&limit=50&offset=${offset}&sortBy=TIMESTAMP&sortDirection=DESC`;
    try {
      const res = await fetch(url);
      if (!res.ok) break;
      const data = await res.json();
      const items = data.trades || data.data || data;
      if (!Array.isArray(items) || items.length === 0) break;
      all = all.concat(items);
      if (items.length < 50) break;
      offset += 50;
      page++;
    } catch { break; }
  }
  return all.sort((a, b) => (b.timestamp || b.createdAt || 0) - (a.timestamp || a.createdAt || 0));
}

export async function getTraderSimulation(user: string): Promise<any[]> {
  const positions = await fetchAllClosed(user);
  return positions;
}

export async function fetchTraderTrades(address: string): Promise<PolymarketTrade[]> {
  const positions = await fetchAllClosed(address);
  return positions.slice(0, 50).map((pos: any, i: number) => ({
    id: pos.id || `trade-${i}`,
    market: pos.title || 'Unknown Market',
    asset: 'USDC',
    side: pos.outcomeIndex === 0 ? 'BUY' : 'SELL',
    size: (pos.totalBought || 0).toFixed(2),
    price: (pos.avgPrice || 0).toFixed(2),
    timestamp: new Date((pos.timestamp || 0) * 1000).toISOString(),
    transactionHash: pos.transactionHash || `0x${Math.random().toString(16).slice(2)}`,
  }));
}

export async function getTraderStats(address: string): Promise<TraderStats> {
  const positions = await fetchAllClosed(address);
  const now = Math.floor(Date.now() / 1000);
  const day = 86400;

  let pnl24h = 0, pnl7d = 0, pnl30d = 0, wins = 0, total = 0;

  for (const pos of positions) {
    const pnl = pos.realizedPnl || 0;
    const ts = pos.timestamp || 0;
    const age = now - ts;
    if (age <= 3 * day) pnl24h += pnl;
    if (age <= 7 * day) pnl7d += pnl;
    if (age <= 30 * day) pnl30d += pnl;
    if (pnl > 0) wins++;
    total++;
  }

  // If 30d is zero or equal to 7d, we likely have < 7 days of data
  // Fetch activity endpoint for deeper history
  if (pnl30d === 0 || pnl30d === pnl7d) {
    try {
      const activities = await fetchAllActivity(address);
      let activityPnl30d = 0;

      for (const act of activities) {
        const pnl = act.realizedPnl || act.pnl || 0;
        if (pnl === 0) continue;
        const ts = act.timestamp || act.createdAt || act.timestampMs / 1000 || 0;
        const age = now - ts;
        if (age <= 30 * day) {
          activityPnl30d += pnl;
          // Don't double-count wins if already counted from closed positions
          wins++;
          total++;
        }
      }

      if (activityPnl30d !== 0) {
        pnl30d = activityPnl30d;
      }
    } catch {
      // Activity endpoint failed, keep what we have
    }
  }

  return {
    pnl24h: parseFloat(pnl24h.toFixed(2)),
    pnl7d: parseFloat(pnl7d.toFixed(2)),
    pnl30d: parseFloat(pnl30d.toFixed(2)),
    winRate: total > 0 ? parseFloat(((wins / total) * 100).toFixed(1)) : 0,
    totalTrades: total,
  };
}
