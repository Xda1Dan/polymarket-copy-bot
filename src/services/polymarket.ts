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
  while (offset <= 200) {
    const res = await fetch(`${API}/closed-positions?user=${user}&limit=50&offset=${offset}&sortBy=TIMESTAMP&sortDirection=DESC`);
    if (!res.ok) break;
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) break;
    all = all.concat(data);
    offset += 50;
  }
  return all.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
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
    const age = now - (pos.timestamp || 0);
    if (age <= day) pnl24h += pnl;
    if (age <= 7 * day) pnl7d += pnl;
    if (age <= 30 * day) pnl30d += pnl;
    if (pnl > 0) wins++;
    total++;
  }

  return {
    pnl24h: parseFloat(pnl24h.toFixed(2)),
    pnl7d: parseFloat(pnl7d.toFixed(2)),
    pnl30d: parseFloat(pnl30d.toFixed(2)),
    winRate: total > 0 ? parseFloat(((wins / total) * 100).toFixed(1)) : 0,
    totalTrades: total,
  };
}
