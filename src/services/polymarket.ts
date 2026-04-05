import axios from 'axios';

// Polymarket CLOB API Base URL
const CLOB_API_URL = 'https://clob.polymarket.com';

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

export async function fetchTraderTrades(address: string): Promise<PolymarketTrade[]> {
  try {
    // Note: Polymarket CLOB API might have specific endpoints for trades by address
    // This is a placeholder for the actual API call logic
    // In a real scenario, we'd use their subgraph or specific CLOB endpoints
    const response = await axios.get(`${CLOB_API_URL}/trades?maker_address=${address}`);
    return response.data;
  } catch (error) {
    console.error('Error fetching trader trades:', error);
    // Return mock data for demo purposes if API fails or for simulation
    return generateMockTrades(address);
  }
}

function generateMockTrades(address: string): PolymarketTrade[] {
  const sides: ('BUY' | 'SELL')[] = ['BUY', 'SELL'];
  const markets = [
    "Will Bitcoin hit $100k in 2024?",
    "Will Trump win the 2024 election?",
    "Will Ethereum ETF be approved by May?",
    "Will Fed cut rates in June?"
  ];

  return Array.from({ length: 10 }).map((_, i) => ({
    id: `trade-${i}`,
    market: markets[Math.floor(Math.random() * markets.length)],
    asset: "USDC",
    side: sides[Math.floor(Math.random() * sides.length)],
    size: (Math.random() * 1000).toFixed(2),
    price: (Math.random() * 0.9 + 0.05).toFixed(2),
    timestamp: new Date(Date.now() - i * 3600000).toISOString(),
    transactionHash: `0x${Math.random().toString(16).slice(2)}`
  }));
}

export async function getTraderStats(address: string): Promise<TraderStats> {
  // Mocking stats calculation
  return {
    pnl24h: Math.random() * 2000 - 500,
    pnl7d: Math.random() * 5000 - 1000,
    pnl30d: Math.random() * 15000 - 2000,
    winRate: 65 + Math.random() * 15,
    totalTrades: 120 + Math.floor(Math.random() * 50)
  };
}
