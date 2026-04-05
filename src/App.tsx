/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Activity,
  Plus,
  Trash2,
  TrendingUp,
  TrendingDown,
  Wallet,
  RefreshCw,
  ExternalLink,
  ChevronRight,
  Bot,
  User,
  BarChart3
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer
} from 'recharts';
import { cn, formatCurrency, formatAddress } from './lib/utils';
import { fetchTraderTrades, getTraderStats, getTraderSimulation, PolymarketTrade, TraderStats, SimulatedTrade } from './services/polymarket';

// Types
interface BotInstance {
  id: string;
  name: string;
  traderAddress: string;
  status: 'active' | 'paused';
  virtualBalance: number;
  initialBalance: number;
  tradeAmount: number;
  maxPerMarket: number;
  createdAt: string;
}

interface BotSimulation {
  balance: number;
  pnl24h: number;
  pnl7d: number;
  pnl30d: number;
  winRate: number;
  totalTrades: number;
  trades: SimulatedTrade[];
  performanceData: { time: string; value: number }[];
}

// Constants
const BOTS_KEY = 'polysim_bots';
const SIM_CACHE_KEY = 'polysim_cache';

const loadBots = (): BotInstance[] => {
  try { return JSON.parse(localStorage.getItem(BOTS_KEY) || '[]'); } catch { return []; }
};

const saveBots = (all: BotInstance[]) => {
  localStorage.setItem(BOTS_KEY, JSON.stringify(all));
};

const loadSimCache = (botId: string): BotSimulation | null => {
  try {
    const cache = JSON.parse(localStorage.getItem(SIM_CACHE_KEY) || '{}');
    const entry = cache[botId];
    if (entry && (Date.now() - entry.cachedAt < 60000)) {
      const { cachedAt, ...data } = entry;
      return data;
    }
    return null;
  } catch { return null; }
};

const saveSimCache = (botId: string, sim: BotSimulation) => {
  try {
    const cache = JSON.parse(localStorage.getItem(SIM_CACHE_KEY) || '{}');
    cache[botId] = { ...sim, cachedAt: Date.now() };
    localStorage.setItem(SIM_CACHE_KEY, JSON.stringify(cache));
  } catch { /* noop */ }
};

// Simulation engine
function runSimulation(traderAddress: string, initialBalance: number, tradeAmount: number, maxPerMarket: number): Promise<BotSimulation> {
  return new Promise(async (resolve, reject) => {
    try {
      const positions = await getTraderSimulation(traderAddress);
      
      if (!positions || positions.length === 0) {
        resolve({
          balance: initialBalance,
          pnl24h: 0, pnl7d: 0, pnl30d: 0,
          winRate: 0, totalTrades: 0, trades: [], performanceData: [],
        });
        return;
      }

      let balance = initialBalance;
      const marketExposure: Record<string, number> = {};
      const trades: SimulatedTrade[] = [];
      const perfHistory: number[] = [];
      const now = Date.now() / 1000;

      for (const pos of positions) {
        const mKey = pos.conditionId || pos.asset || pos.market_slug || JSON.stringify(pos);
        const side = pos.outcomeIndex === 0 ? 'YES' : 'NO';
        const roiPct = pos.totalBought && pos.realizedPnl !== undefined ? (pos.realizedPnl / pos.totalBought) * 100 : 0;
        const exposure = marketExposure[mKey] || 0;

        if (exposure >= maxPerMarket || balance < tradeAmount) continue;

        balance -= tradeAmount;
        marketExposure[mKey] = exposure + tradeAmount;

        const profit = tradeAmount * (roiPct / 100);
        balance += profit;
        marketExposure[mKey] = Math.max(0, (marketExposure[mKey] || 0) - tradeAmount);

        const posTime = (pos.timestamp || 0) * 1000;
        const timeStr = new Date(posTime).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

        trades.push({
          id: pos.id || `sim-${trades.length}`,
          market: pos.title || 'Unknown Market',
          side,
          amount: tradeAmount,
          roi: roiPct,
          profit,
          balanceAfter: balance,
          time: timeStr,
          timestamp: pos.timestamp || 0,
        });

        perfHistory.push(balance);
      }

      const wins = trades.filter(t => t.profit > 0).length;
      const total = trades.length;
      const performanceData = perfHistory.map((v, i) => ({
        time: `${i}`,
        value: parseFloat(v.toFixed(2)),
      }));

      const pnl24 = trades.filter(t => now - t.timestamp <= 86400).reduce((s, t) => s + t.profit, 0);
      const pnl7 = trades.filter(t => now - t.timestamp <= 604800).reduce((s, t) => s + t.profit, 0);
      const pnl30 = trades.filter(t => now - t.timestamp <= 2592000).reduce((s, t) => s + t.profit, 0);

      resolve({
        balance: parseFloat(balance.toFixed(2)),
        pnl24h: parseFloat(pnl24.toFixed(2)),
        pnl7d: parseFloat(pnl7.toFixed(2)),
        pnl30d: parseFloat(pnl30.toFixed(2)),
        winRate: total > 0 ? parseFloat(((wins / total) * 100).toFixed(1)) : 0,
        totalTrades: total,
        trades,
        performanceData: performanceData.length > 0 ? performanceData : [{ time: '0', value: initialBalance }],
      });
    } catch (e) { reject(e); }
  });
}

// Components
function StatCard({ label, value, sub, positive }: { label: string; value: string; sub?: string; positive?: boolean }) {
  return (
    <div className="glass-card p-6 rounded-3xl">
      <div className="flex items-center justify-between mb-4">
        <div className="p-2 rounded-xl bg-zinc-800">
          <Wallet className="w-5 h-5 text-zinc-400" />
        </div>
        <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">{label}</span>
      </div>
      <p className={cn("text-2xl font-bold", positive === true ? "text-green-500" : positive === false ? "text-red-500" : "")}>{value}</p>
      {sub && <p className="text-zinc-500 text-xs mt-1">{sub}</p>}
    </div>
  );
}

export default function App() {
  const [bots, setBots] = useState<BotInstance[]>([]);
  const [selectedBotId, setSelectedBotId] = useState<string | null>(null);
  const [traderStats, setTraderStats] = useState<TraderStats | null>(null);
  const [recentTrades, setRecentTrades] = useState<PolymarketTrade[]>([]);
  const [simResult, setSimResult] = useState<BotSimulation | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAddingBot, setIsAddingBot] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [newBotData, setNewBotData] = useState({
    name: '',
    address: '',
    balance: '1000',
    tradeAmount: '50',
    maxPerMarket: '200'
  });
  const [editSettings, setEditSettings] = useState(false);
  const [editData, setEditData] = useState<{ tradeAmount: string; maxPerMarket: string }>({ tradeAmount: '', maxPerMarket: '' });
  const [chartPeriod, setChartPeriod] = useState<'24H' | '7D' | '30D' | 'ALL'>('ALL');
  const simRef = useRef(false);

  const selectedBot = bots.find(b => b.id === selectedBotId);

  // Load bots on mount
  useEffect(() => {
    const loaded = loadBots();
    setBots(loaded);
    if (loaded.length > 0 && !selectedBotId) {
      setSelectedBotId(loaded[0].id);
    }
    setIsLoading(false);
  }, []);

  // Load data when bot selected
  useEffect(() => {
    if (!selectedBot) return;
    loadData(selectedBot);
  }, [selectedBotId]);

  const loadData = async (bot: BotInstance) => {
    setIsLoading(true);
    try {
      // Check cache first
      const cached = loadSimCache(bot.id);
      if (cached) {
        setSimResult(cached);
        setIsLoading(false);
      }

      // Fetch trader stats + recent actual trades in parallel with simulation
      const [stats, trades] = await Promise.all([
        getTraderStats(bot.traderAddress),
        fetchTraderTrades(bot.traderAddress),
      ]);
      setTraderStats(stats);
      setRecentTrades(trades.slice(0, 15));

      // Run simulation if no cache
      if (!cached) {
        const sim = await runSimulation(bot.traderAddress, bot.initialBalance, bot.tradeAmount, bot.maxPerMarket);
        setSimResult(sim);
        saveSimCache(bot.id, sim);
        // Update bot balance
        updateBotBalance(bot.id, sim.balance);
      }
    } catch (err) {
      console.error('Failed to load data', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRefresh = useCallback(() => {
    if (selectedBot) loadData(selectedBot);
  }, [selectedBot]);

  const updateBotBalance = (id: string, bal: number) => {
    const updated = bots.map(b => b.id === id ? { ...b, virtualBalance: bal } : b);
    setBots(updated);
    saveBots(updated);
  };

  const handleSaveSettings = () => {
    if (!selectedBot) return;
    const updated = bots.map(b => b.id === selectedBot.id ? {
      ...b,
      tradeAmount: Number(editData.tradeAmount) || 50,
      maxPerMarket: Number(editData.maxPerMarket) || 200,
    } : b);
    setBots(updated);
    saveBots(updated);
    setEditSettings(false);
    // Re-run sim with new settings
    loadData({ ...updated.find(b => b.id === selectedBot.id)!, tradeAmount: Number(editData.tradeAmount) || 50, maxPerMarket: Number(editData.maxPerMarket) || 200 });
  };

  const handleAddBot = (e: React.FormEvent) => {
    e.preventDefault();
    const newBot: BotInstance = {
      id: Math.random().toString(36).substring(7),
      name: newBotData.name,
      traderAddress: newBotData.address,
      status: 'active',
      virtualBalance: Number(newBotData.balance) || 1000,
      initialBalance: Number(newBotData.balance) || 1000,
      tradeAmount: Number(newBotData.tradeAmount) || 50,
      maxPerMarket: Number(newBotData.maxPerMarket) || 200,
      createdAt: new Date().toISOString(),
    };
    const updated = [...bots, newBot];
    setBots(updated);
    saveBots(updated);
    setIsAddingBot(false);
    setNewBotData({ name: '', address: '', balance: '1000', tradeAmount: '50', maxPerMarket: '200' });
    setSelectedBotId(newBot.id);
  };

  const deleteBot = (id: string) => {
    const updated = bots.filter(b => b.id !== id);
    setBots(updated);
    saveBots(updated);
    // Clear sim cache
    try {
      const cache = JSON.parse(localStorage.getItem(SIM_CACHE_KEY) || '{}');
      delete cache[id];
      localStorage.setItem(SIM_CACHE_KEY, JSON.stringify(cache));
    } catch { /* noop */ }
    if (selectedBotId === id) {
      setSelectedBotId(updated.length > 0 ? updated[0].id : null);
    }
  };

  // Chart data filtered by period
  const filteredChartData = React.useMemo(() => {
    if (!simResult) return [];
    const all = simResult.performanceData;
    const total = all.length;
    let slice = total;
    if (chartPeriod === '24H') slice = Math.max(1, Math.floor(total * 0.1));
    else if (chartPeriod === '7D') slice = Math.max(1, Math.floor(total * 0.3));
    else if (chartPeriod === '30D') slice = Math.max(1, Math.floor(total * 0.6));
    return all.slice(Math.max(0, total - slice));
  }, [simResult, chartPeriod]);

  // Chart time range for Y-axis
  const chartRange = React.useMemo(() => {
    if (filteredChartData.length < 2) return { min: 0, max: 2000 };
    const vals = filteredChartData.map(d => d.value);
    return { min: Math.floor(Math.min(...vals) * 0.95), max: Math.ceil(Math.max(...vals) * 1.05) };
  }, [filteredChartData]);

  return (
    <div className="min-h-screen flex flex-col font-sans">
      {/* Header */}
      <header className="h-16 border-b border-zinc-800 flex items-center justify-between px-4 md:px-6 bg-zinc-950/80 backdrop-blur-md sticky top-0 z-40">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            className="md:hidden p-2 hover:bg-zinc-900 rounded-lg"
          >
            <Activity className="w-5 h-5" />
          </button>
          <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center shrink-0">
            <Bot className="text-zinc-950 w-5 h-5" />
          </div>
          <h1 className="text-lg font-semibold tracking-tight hidden sm:block">PolySim</h1>
          <span className="px-2 py-0.5 rounded-full bg-zinc-800 text-[10px] font-medium text-zinc-400 uppercase tracking-wider">Sim</span>
        </div>

        <div className="flex items-center gap-2 md:gap-4">
          <button
            onClick={() => setIsAddingBot(true)}
            className="flex items-center gap-2 bg-white text-zinc-950 px-3 md:px-4 py-2 rounded-full text-xs md:text-sm font-medium hover:bg-zinc-200 transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">New Bot</span>
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden relative">
        {/* Sidebar */}
        <aside className={cn(
          "fixed inset-y-0 left-0 z-30 w-72 border-r border-zinc-800 flex flex-col bg-zinc-950 transition-transform duration-300 md:relative md:translate-x-0",
          isSidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}>
          <div className="p-4 border-b border-zinc-800">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-widest">Your Bots</h2>
              <button onClick={() => setIsSidebarOpen(false)} className="md:hidden text-zinc-500">
                <ChevronRight className="w-4 h-4 rotate-180" />
              </button>
            </div>
            <div className="space-y-1 overflow-y-auto max-h-[calc(100vh-16rem)]">
              {bots.map(bot => (
                <button
                  key={bot.id}
                  onClick={() => { setSelectedBotId(bot.id); setIsSidebarOpen(false); }}
                  className={cn(
                    "w-full flex items-center justify-between p-3 rounded-xl transition-all group",
                    selectedBotId === bot.id
                      ? "bg-zinc-900 border border-zinc-800"
                      : "hover:bg-zinc-900/50 border border-transparent"
                  )}
                >
                  <div className="flex items-center gap-3">
                    <div className={cn(
                      "w-2 h-2 rounded-full shrink-0",
                      bot.status === 'active' ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]" : "bg-zinc-600"
                    )} />
                    <div className="text-left overflow-hidden">
                      <p className="text-sm font-medium truncate">{bot.name}</p>
                      <p className="text-[10px] text-zinc-500 font-mono truncate">{formatAddress(bot.traderAddress)}</p>
                    </div>
                  </div>
                </button>
              ))}
              {bots.length === 0 && (
                <div className="text-center py-8">
                  <p className="text-sm text-zinc-500">No bots yet</p>
                </div>
              )}
            </div>
          </div>
          <div className="mt-auto p-4 border-t border-zinc-800">
            <div className="p-4 rounded-2xl bg-zinc-900/50 border border-zinc-800">
              <p className="text-xs text-zinc-500 mb-1">Total Virtual Equity</p>
              <p className="text-xl font-semibold">
                {formatCurrency(bots.reduce((acc, b) => acc + b.virtualBalance, 0))}
              </p>
            </div>
          </div>
        </aside>

        {isSidebarOpen && (
          <div className="fixed inset-0 bg-black/50 z-20 md:hidden" onClick={() => setIsSidebarOpen(false)} />
        )}

        {/* Main Content */}
        <main className="flex-1 overflow-y-auto bg-zinc-950 p-4 md:p-8">
          {selectedBot ? (
            <div className="max-w-6xl mx-auto space-y-6 md:space-y-8">
              {/* Bot Header */}
              <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                <div>
                  <div className="flex items-center gap-3 mb-2">
                    <h2 className="text-2xl md:text-3xl font-bold tracking-tight">{selectedBot.name}</h2>
                    <span className="px-2 py-0.5 rounded-md bg-green-500/10 text-green-500 text-[10px] font-bold uppercase">{selectedBot.status}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 md:gap-4 text-zinc-400 text-xs md:text-sm">
                    <div className="flex items-center gap-1.5">
                      <User className="w-4 h-4" />
                      <span className="font-mono">{formatAddress(selectedBot.traderAddress)}</span>
                      <a href={`https://polymarket.com/profile/${selectedBot.traderAddress}`} target="_blank" rel="noopener noreferrer" className="hover:text-white">
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                    <div className="hidden sm:block w-1 h-1 rounded-full bg-zinc-800" />
                    <span>Created {new Date(selectedBot.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleRefresh}
                    className="flex-1 md:flex-none p-2.5 rounded-xl border border-zinc-800 hover:bg-zinc-900 transition-colors flex items-center justify-center"
                    title="Refresh data"
                  >
                    <RefreshCw className={cn("w-5 h-5 text-zinc-400", isLoading && "animate-spin")} />
                  </button>
                  <button
                    onClick={() => deleteBot(selectedBot.id)}
                    className="flex-1 md:flex-none p-2.5 rounded-xl border border-zinc-800 hover:bg-red-500/10 hover:border-red-500/50 group transition-all flex items-center justify-center"
                  >
                    <Trash2 className="w-5 h-5 text-zinc-400 group-hover:text-red-500" />
                  </button>
                </div>
              </div>

              {/* Risk Controls */}
              <div className="glass-card p-4 rounded-2xl flex flex-wrap gap-6 items-center justify-between border-zinc-800/50">
                <div className="flex items-center gap-4">
                  <div className="p-2 rounded-lg bg-zinc-800/50">
                    <Activity className="w-4 h-4 text-zinc-400" />
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Risk Controls</p>
                    <div className="flex gap-4 mt-1">
                      <span className="text-xs text-zinc-300">Amount/Trade: <b className="text-white">{formatCurrency(selectedBot.tradeAmount)}</b></span>
                      <span className="text-xs text-zinc-300">Max/Market: <b className="text-white">{formatCurrency(selectedBot.maxPerMarket)}</b></span>
                    </div>
                  </div>
                </div>
                <button
                  className="text-[10px] font-bold text-zinc-400 hover:text-white uppercase tracking-widest transition-colors"
                  onClick={() => {
                    setEditData({ tradeAmount: String(selectedBot.tradeAmount), maxPerMarket: String(selectedBot.maxPerMarket) });
                    setEditSettings(true);
                  }}
                >
                  Edit Settings
                </button>
              </div>

              {/* Edit Settings Modal */}
              <AnimatePresence>
                {editSettings && (
                  <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setEditSettings(false)} className="absolute inset-0 bg-zinc-950/80 backdrop-blur-sm" />
                    <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }} className="relative w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-3xl p-8 shadow-2xl">
                      <h3 className="text-xl font-bold mb-6">Edit Risk Settings</h3>
                      <div className="space-y-4">
                        <div className="space-y-2">
                          <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider ml-1">Trade Amount (USDC)</label>
                          <input type="number" className="w-full bg-zinc-950 border border-zinc-800 rounded-2xl px-4 py-3 text-sm focus:outline-none focus:border-white transition-colors" value={editData.tradeAmount} onChange={e => setEditData({ ...editData, tradeAmount: e.target.value })} />
                        </div>
                        <div className="space-y-2">
                          <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider ml-1">Max Per Market (USDC)</label>
                          <input type="number" className="w-full bg-zinc-950 border border-zinc-800 rounded-2xl px-4 py-3 text-sm focus:outline-none focus:border-white transition-colors" value={editData.maxPerMarket} onChange={e => setEditData({ ...editData, maxPerMarket: e.target.value })} />
                        </div>
                        <div className="pt-4 flex gap-3">
                          <button onClick={() => setEditSettings(false)} className="flex-1 px-6 py-3 rounded-2xl border border-zinc-800 font-semibold hover:bg-zinc-800 transition-colors">Cancel</button>
                          <button onClick={handleSaveSettings} className="flex-1 bg-white text-zinc-950 px-6 py-3 rounded-2xl font-bold hover:bg-zinc-200 transition-colors">Save</button>
                        </div>
                      </div>
                    </motion.div>
                  </div>
                )}
              </AnimatePresence>

              {/* Loading State */}
              {isLoading && !simResult ? (
                <div className="text-center py-20 text-zinc-500">
                  <RefreshCw className="w-8 h-8 mx-auto mb-4 animate-spin" />
                  <p className="text-sm">Loading trader data and simulating trades...</p>
                </div>
              ) : (
                <>
                  {/* Stats Grid */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <StatCard
                      label="Balance"
                      value={simResult ? formatCurrency(simResult.balance) : formatCurrency(selectedBot.virtualBalance)}
                      sub={`Initial: ${formatCurrency(selectedBot.initialBalance)}`}
                    />
                    <div className="glass-card p-6 rounded-3xl">
                      <div className="flex items-center justify-between mb-4">
                        <div className="p-2 rounded-xl bg-zinc-800">
                          <Activity className="w-5 h-5 text-zinc-400" />
                        </div>
                        <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">PnL (24h / 7d / 30d)</span>
                      </div>
                      <div className="space-y-2">
                        {(['pnl24h', 'pnl7d', 'pnl30d'] as const).map(key => {
                          const labels = { pnl24h: '24h', pnl7d: '7d', pnl30d: '30d' };
                          const val = simResult ? simResult[key] : (traderStats?.[key] || 0);
                          return (
                            <div key={key} className="flex items-center justify-between">
                              <span className="text-xs text-zinc-500">{labels[key]}</span>
                              <span className={cn("text-sm font-bold", val >= 0 ? "text-green-500" : "text-red-500")}>
                                {formatCurrency(val)}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                    <div className="glass-card p-6 rounded-3xl">
                      <div className="flex items-center justify-between mb-4">
                        <div className="p-2 rounded-xl bg-zinc-800">
                          <BarChart3 className="w-5 h-5 text-zinc-400" />
                        </div>
                        <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Win Rate</span>
                      </div>
                      <p className="text-2xl font-bold">{simResult ? `${simResult.winRate}%` : `${(traderStats?.winRate || 0).toFixed(1)}%`}</p>
                      <div className="w-full bg-zinc-800 h-1.5 rounded-full mt-3 overflow-hidden">
                        <div className="bg-white h-full rounded-full" style={{ width: `${simResult ? simResult.winRate : traderStats?.winRate || 0}%` }} />
                      </div>
                    </div>
                    <div className="glass-card p-6 rounded-3xl">
                      <div className="flex items-center justify-between mb-4">
                        <div className="p-2 rounded-xl bg-zinc-800">
                          <RefreshCw className="w-5 h-5 text-zinc-400" />
                        </div>
                        <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Trades</span>
                      </div>
                      <p className="text-2xl font-bold">{simResult ? simResult.totalTrades : (traderStats?.totalTrades || 0)}</p>
                      <p className="text-zinc-500 text-xs mt-1">
                        {simResult ? 'simulated' : 'trader lifetime'}
                      </p>
                    </div>
                  </div>

                  {/* Performance Chart */}
                  <div className="glass-card p-8 rounded-3xl">
                    <div className="flex items-center justify-between mb-8">
                      <h3 className="text-lg font-semibold">Simulated Performance</h3>
                      <div className="flex gap-2">
                        {(['24H', '7D', '30D', 'ALL'] as const).map(t => (
                          <button key={t} onClick={() => setChartPeriod(t)} className={cn(
                            "px-3 py-1 rounded-lg text-[10px] font-bold transition-colors",
                            chartPeriod === t ? "bg-white text-zinc-950" : "text-zinc-500 hover:text-white"
                          )}>
                            {t}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="h-[300px] w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={filteredChartData.length > 1 ? filteredChartData : [{ time: 'start', value: selectedBot.initialBalance }]}>
                          <defs>
                            <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#ffffff" stopOpacity={0.1} />
                              <stop offset="95%" stopColor="#ffffff" stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                          <XAxis dataKey="time" stroke="#71717a" fontSize={10} tickLine={false} axisLine={false} tick={false} />
                          <YAxis stroke="#71717a" fontSize={10} tickLine={false} axisLine={false} domain={[chartRange.min, chartRange.max]} tickFormatter={(val) => `$${val}`} />
                          <Tooltip
                            contentStyle={{ backgroundColor: '#18181b', border: '1px solid #27272a', borderRadius: '12px' }}
                            itemStyle={{ color: '#ffffff' }}
                            formatter={(val: number) => [`$${val.toFixed(2)}`, 'Balance']}
                          />
                          <Area type="monotone" dataKey="value" stroke="#ffffff" strokeWidth={2}
                            fillOpacity={1} fill="url(#colorValue)" isAnimationActive={false} />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  {/* Simulated Trades Table */}
                  {simResult && simResult.trades.length > 0 ? (
                    <div className="glass-card rounded-3xl overflow-hidden">
                      <div className="p-6 border-b border-zinc-800 flex items-center justify-between">
                        <h3 className="text-lg font-semibold">Simulated Trade History</h3>
                        <span className="text-xs text-zinc-500">{simResult.trades.length} trades replayed</span>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-left">
                          <thead>
                            <tr className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider border-b border-zinc-800">
                              <th className="px-6 py-4">Market</th>
                              <th className="px-6 py-4">Side</th>
                              <th className="px-6 py-4">Amount</th>
                              <th className="px-6 py-4 right">ROI</th>
                              <th className="px-6 py-4 right">P&L</th>
                              <th className="px-6 py-4 right">Balance</th>
                              <th className="px-6 py-4 right">Time</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-zinc-800/50">
                            {[...simResult.trades].reverse().map((trade) => (
                              <tr key={trade.id} className="hover:bg-zinc-900/30 transition-colors">
                                <td className="px-6 py-4">
                                  <span className="text-sm font-medium line-clamp-1">{trade.market.length > 50 ? trade.market.substring(0, 50) + '…' : trade.market}</span>
                                </td>
                                <td className="px-6 py-4">
                                  <span className={cn(
                                    "px-2 py-1 rounded-md text-[10px] font-bold",
                                    trade.side === 'YES' ? "bg-green-500/10 text-green-500" : "bg-red-500/10 text-red-500"
                                  )}>
                                    {trade.side}
                                  </span>
                                </td>
                                <td className="px-6 py-4 text-sm font-mono">{formatCurrency(trade.amount)}</td>
                                <td className="px-6 py-4 text-sm font-mono text-right">{trade.roi >= 0 ? '+' : ''}{trade.roi.toFixed(1)}%</td>
                                <td className={cn("px-6 py-4 text-sm font-mono text-right", trade.profit >= 0 ? "text-green-500" : "text-red-500")}>
                                  {trade.profit >= 0 ? '+' : ''}{formatCurrency(trade.profit)}
                                </td>
                                <td className="px-6 py-4 text-sm font-mono text-right">{formatCurrency(trade.balanceAfter)}</td>
                                <td className="px-6 py-4 text-xs text-zinc-500 text-right">{trade.time}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-12 text-zinc-500">
                      <p className="text-sm">{simResult ? 'No trades matched your risk settings' : 'Waiting for simulation...'}</p>
                    </div>
                  )}
                </>
              )}
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-center space-y-6">
              <div className="w-20 h-20 bg-zinc-900 rounded-3xl flex items-center justify-center border border-zinc-800">
                <Bot className="w-10 h-10 text-zinc-500" />
              </div>
              <div>
                <h2 className="text-2xl font-bold tracking-tight mb-2">No Bot Selected</h2>
                <p className="text-zinc-500 max-w-sm">Create a bot to start simulating copy trades.</p>
              </div>
              <button onClick={() => setIsAddingBot(true)} className="bg-white text-zinc-950 px-6 py-3 rounded-full font-semibold hover:bg-zinc-200 transition-all">
                Create Your First Bot
              </button>
            </div>
          )}
        </main>
      </div>

      {/* Add Bot Modal */}
      <AnimatePresence>
        {isAddingBot && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setIsAddingBot(false)} className="absolute inset-0 bg-zinc-950/80 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }} className="relative w-full max-w-lg bg-zinc-900 border border-zinc-800 rounded-[32px] p-6 md:p-8 shadow-2xl overflow-y-auto max-h-[90vh]">
              <h3 className="text-2xl font-bold tracking-tight mb-6">Deploy New Bot</h3>
              <form onSubmit={handleAddBot} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider ml-1">Bot Name</label>
                    <input type="text" required placeholder="e.g. Stingo Follower" className="w-full bg-zinc-950 border border-zinc-800 rounded-2xl px-4 py-3 text-sm focus:outline-none focus:border-white transition-colors" value={newBotData.name} onChange={e => setNewBotData({ ...newBotData, name: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider ml-1">Initial Balance (USDC)</label>
                    <input type="number" required className="w-full bg-zinc-950 border border-zinc-800 rounded-2xl px-4 py-3 text-sm focus:outline-none focus:border-white transition-colors" value={newBotData.balance} onChange={e => setNewBotData({ ...newBotData, balance: e.target.value })} />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider ml-1">Trader Address</label>
                  <input type="text" required placeholder="0x..." className="w-full bg-zinc-950 border border-zinc-800 rounded-2xl px-4 py-3 text-sm font-mono focus:outline-none focus:border-white transition-colors" value={newBotData.address} onChange={e => setNewBotData({ ...newBotData, address: e.target.value })} />
                </div>
                <div className="p-4 rounded-2xl bg-zinc-950 border border-zinc-800 space-y-4">
                  <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Risk Management</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-[10px] font-bold text-zinc-400 uppercase ml-1">Trade Amount (USDC)</label>
                      <input type="number" required className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-white transition-colors" value={newBotData.tradeAmount} onChange={e => setNewBotData({ ...newBotData, tradeAmount: e.target.value })} />
                      <p className="text-[9px] text-zinc-600 ml-1">Per trade investment</p>
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] font-bold text-zinc-400 uppercase ml-1">Max Per Market (USDC)</label>
                      <input type="number" required className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-white transition-colors" value={newBotData.maxPerMarket} onChange={e => setNewBotData({ ...newBotData, maxPerMarket: e.target.value })} />
                      <p className="text-[9px] text-zinc-600 ml-1">Max exposure per market</p>
                    </div>
                  </div>
                </div>
                <div className="pt-4 flex gap-3">
                  <button type="button" onClick={() => setIsAddingBot(false)} className="flex-1 px-6 py-3 rounded-2xl border border-zinc-800 font-semibold hover:bg-zinc-800 transition-colors">Cancel</button>
                  <button type="submit" className="flex-1 bg-white text-zinc-950 px-6 py-3 rounded-2xl font-bold hover:bg-zinc-200 transition-colors">Deploy Bot</button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
