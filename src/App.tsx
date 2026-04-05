/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Activity, Plus, Trash2, Wallet, RefreshCw, ExternalLink,
  ChevronRight, Bot, User, BarChart3, TrendingUp, ArrowRight,
  Target, Clock, Eye, X
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LineChart, Line
} from 'recharts';
import { cn, formatCurrency, formatAddress } from './lib/utils';
import {
  getTraderStats, getTraderOpenPositions, getTraderClosedPositions,
  getTraderPerfData, runSimulation,
  TraderStats, PolymarketPosition, SimResult
} from './services/polymarket';

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

// Constants
const BOTS_KEY = 'polysim_bots';
const loadBots = (): BotInstance[] => {
  try { return JSON.parse(localStorage.getItem(BOTS_KEY) || '[]'); } catch { return []; }
};
const saveBots = (b: BotInstance[]) => localStorage.setItem(BOTS_KEY, JSON.stringify(b));

// ---- Helper Components ----
function PnLBadge({ value, small }: { value: number; small?: boolean }) {
  const positive = value >= 0;
  return (
    <span className={cn(
      "font-mono font-bold",
      positive ? "text-green-500" : "text-red-500",
      small ? "text-xs" : "text-sm"
    )}>
      {positive ? '+' : ''}{formatCurrency(value)}
    </span>
  );
}

function MiniStat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div>
      <p className="text-[10px] font-bold text-zinc-600 uppercase tracking-wider">{label}</p>
      <p className="text-lg font-bold mt-0.5">{value}</p>
      {sub && <p className="text-[10px] text-zinc-600 mt-0.5">{sub}</p>}
    </div>
  );
}

function SectionHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-4">
      <div>
        <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
        {subtitle && <p className="text-xs text-zinc-600 mt-0.5">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

function LoadingBlock({ text }: { text: string }) {
  return (
    <div className="text-center py-16 text-zinc-600">
      <RefreshCw className="w-6 h-6 mx-auto mb-3 animate-spin" />
      <p className="text-sm">{text}</p>
    </div>
  );
}

// ---- Position Table Components ----
function OpenPositionsTable({ positions }: { positions: PolymarketPosition[] }) {
  if (!positions.length) return <div className="text-center py-8 text-zinc-600 text-sm">No open positions</div>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left">
        <thead>
          <tr className="text-[10px] font-bold text-zinc-600 uppercase tracking-wider border-b border-zinc-800">
            <th className="px-4 py-3">Market</th>
            <th className="px-4 py-3">Side</th>
            <th className="px-4 py-3 text-right">Size</th>
            <th className="px-4 py-3 text-right">Avg Price</th>
            <th className="px-4 py-3 text-right">Current Price</th>
            <th className="px-4 py-3 text-right">Unrealized PnL</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800/50">
          {positions.map((p, i) => {
            const side = p.outcomeIndex === 0 ? 'YES' : 'NO';
            return (
              <tr key={p.id} className="hover:bg-zinc-900/30 transition-colors">
                <td className="px-4 py-3">
                  <p className="text-sm font-medium line-clamp-1 max-w-xs">{p.title}</p>
                </td>
                <td className="px-4 py-3">
                  <span className={cn(
                    "px-2 py-0.5 rounded text-[10px] font-bold",
                    side === 'YES' ? "bg-green-500/10 text-green-500" : "bg-red-500/10 text-red-500"
                  )}>{side}</span>
                </td>
                <td className="px-4 py-3 text-sm font-mono text-right">${p.size.toFixed(2)}</td>
                <td className="px-4 py-3 text-sm font-mono text-right">{(p.avgPrice * 100).toFixed(1)}¢</td>
                <td className="px-4 py-3 text-sm font-mono text-right">{p.currentPrice ? (p.currentPrice * 100).toFixed(1) + '¢' : '—'}</td>
                <td className="px-4 py-3 text-right"><PnLBadge value={p.unrealizedPnl} small /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ClosedPositionsTable({ positions }: { positions: PolymarketPosition[] }) {
  if (!positions.length) return <div className="text-center py-8 text-zinc-600 text-sm">No closed positions</div>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left">
        <thead>
          <tr className="text-[10px] font-bold text-zinc-600 uppercase tracking-wider border-b border-zinc-800">
            <th className="px-4 py-3">Market</th>
            <th className="px-4 py-3">Side</th>
            <th className="px-4 py-3 text-right">Size</th>
            <th className="px-4 py-3 text-right">PnL</th>
            <th className="px-4 py-3 text-right">Date</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800/50">
          {positions.map((p) => {
            const side = p.outcomeIndex === 0 ? 'YES' : 'NO';
            const d = new Date(p.timestamp * 1000);
            return (
              <tr key={p.id} className="hover:bg-zinc-900/30 transition-colors">
                <td className="px-4 py-3">
                  <p className="text-sm font-medium line-clamp-1 max-w-xs">{p.title}</p>
                </td>
                <td className="px-4 py-3">
                  <span className={cn(
                    "px-2 py-0.5 rounded text-[10px] font-bold",
                    side === 'YES' ? "bg-green-500/10 text-green-500" : "bg-red-500/10 text-red-500"
                  )}>{side}</span>
                </td>
                <td className="px-4 py-3 text-sm font-mono text-right">${p.size.toFixed(2)}</td>
                <td className="px-4 py-3 text-right"><PnLBadge value={p.realizedPnl} small /></td>
                <td className="px-4 py-3 text-xs text-zinc-600 text-right font-mono">
                  {d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SimTradesTable({ trades }: { trades: SimResult['trades'] }) {
  if (!trades.length) return <div className="text-center py-8 text-zinc-600 text-sm">No simulated trades yet</div>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left">
        <thead>
          <tr className="text-[10px] font-bold text-zinc-600 uppercase tracking-wider border-b border-zinc-800">
            <th className="px-4 py-3">Market</th>
            <th className="px-4 py-3">Side</th>
            <th className="px-4 py-3 text-right">Amount</th>
            <th className="px-4 py-3 text-right">ROI</th>
            <th className="px-4 py-3 text-right">PnL</th>
            <th className="px-4 py-3 text-right">Balance</th>
            <th className="px-4 py-3 text-right">Date</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800/50">
          {[...trades].reverse().map((t) => (
            <tr key={t.id} className="hover:bg-zinc-900/30 transition-colors">
              <td className="px-4 py-3">
                <p className="text-sm font-medium line-clamp-1 max-w-xs">{t.title}</p>
              </td>
              <td className="px-4 py-3">
                <span className={cn(
                  "px-2 py-0.5 rounded text-[10px] font-bold",
                  t.side === 'YES' ? "bg-green-500/10 text-green-500" : "bg-red-500/10 text-red-500"
                )}>{t.side}</span>
              </td>
              <td className="px-4 py-3 text-sm font-mono text-right">${t.amount}</td>
              <td className="px-4 py-3 text-sm font-mono text-right">{t.roi >= 0 ? '+' : ''}{t.roi.toFixed(1)}%</td>
              <td className="px-4 py-3 text-right"><PnLBadge value={t.profit} small /></td>
              <td className="px-4 py-3 text-sm font-mono text-right">${t.balanceAfter.toFixed(2)}</td>
              <td className="px-4 py-3 text-xs text-zinc-600 text-right font-mono">{t.dateStr}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---- Chart Component ----
function PerfChart({ data, color = '#ffffff' }: { data: { time: number; value: number; dateStr: string }[]; color?: string }) {
  if (!data.length) return <div className="text-center py-12 text-zinc-600 text-sm">No data</div>;
  
  const chartData = data.length > 1 ? data : [{ time: 0, value: data[0]?.value || 1000, dateStr: 'start' }];
  const vals = chartData.map(d => d.value);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const pad = Math.max((max - min) * 0.1, 5);
  
  // Show only some x labels
  const showEvery = Math.max(1, Math.floor(chartData.length / 6));
  
  return (
    <div className="h-[250px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData.map((d, i) => ({ ...d, idx: i }))}>
          <defs>
            <linearGradient id={`grad-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={color} stopOpacity={0.15} />
              <stop offset="95%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#1a1a1a" vertical={false} />
          <XAxis
            dataKey="dateStr"
            stroke="#444"
            fontSize={9}
            tickLine={false}
            axisLine={false}
            interval={showEvery}
          />
          <YAxis
            stroke="#444"
            fontSize={9}
            tickLine={false}
            axisLine={false}
            domain={[Math.floor(min - pad), Math.ceil(max + pad)]}
            tickFormatter={(v) => `$${v}`}
            width={55}
          />
          <Tooltip
            contentStyle={{ backgroundColor: '#111', border: '1px solid #222', borderRadius: '8px' }}
            itemStyle={{ color: '#fff', fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}
            labelStyle={{ color: '#666', fontSize: 10 }}
            formatter={(val: number) => [formatCurrency(val), 'Value']}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke="url(#lineColor)"
            strokeWidth={1.5}
            fillOpacity={1}
            fill={`url(#grad-${color.replace('#', '')})`}
            isAnimationActive={false}
          />
          <defs>
            <linearGradient id="lineColor" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor={color} />
              <stop offset="100%" stopColor={color} />
            </linearGradient>
          </defs>
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---- Comparison Chart ----
function ComparisonChart({ our, theirs }: { our: SimResult['perfData']; theirs: { time: number; value: number; dateStr: string }[] }) {
  const merged: Record<string, { us: number; them: number; dateStr: string }> = {};
  
  for (const d of our) {
    const key = d.time.toString();
    merged[key] = { us: d.value, them: 0, dateStr: d.dateStr };
  }
  for (const d of theirs) {
    const key = d.time.toString();
    if (!merged[key]) {
      merged[key] = { us: 0, them: d.value, dateStr: d.dateStr };
    } else {
      merged[key].them = d.value;
    }
  }
  
  const sorted = Object.entries(merged)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([_, v]) => v);
    
  if (sorted.length < 2) return <div className="text-center py-12 text-zinc-600 text-sm">Not enough data</div>;

  return (
    <div className="h-[250px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={sorted}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1a1a1a" vertical={false} />
          <XAxis dataKey="dateStr" stroke="#444" fontSize={9} tickLine={false} axisLine={false} interval={Math.max(1, Math.floor(sorted.length / 6))} />
          <YAxis stroke="#444" fontSize={9} tickLine={false} axisLine={false} tickFormatter={(v) => `$${v}`} width={55} />
          <Tooltip contentStyle={{ backgroundColor: '#111', border: '1px solid #222', borderRadius: '8px' }} />
          <Line type="monotone" dataKey="us" name="Our Bot" stroke="#ffffff" strokeWidth={1.5} dot={false} isAnimationActive={false} />
          <Line type="monotone" dataKey="them" name="Trader" stroke="#888888" strokeWidth={1.5} dot={false} strokeDasharray="4 4" isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---- Main App ----
export default function App() {
  // Bot management
  const [bots, setBots] = useState<BotInstance[]>([]);
  const [selectedBotId, setSelectedBotId] = useState<string | null>(null);
  
  // Trader data
  const [traderStats, setTraderStats] = useState<TraderStats | null>(null);
  const [traderOpenPos, setTraderOpenPos] = useState<PolymarketPosition[]>([]);
  const [traderClosedPos, setTraderClosedPos] = useState<PolymarketPosition[]>([]);
  const [traderPerf, setTraderPerf] = useState<{ time: number; value: number; dateStr: string }[]>([]);
  
  // Our simulation
  const [simResult, setSimResult] = useState<SimResult | null>(null);
  
  // UI state
  const [loading, setLoading] = useState(true);
  const [isAddingBot, setIsAddingBot] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [mainTab, setMainTab] = useState<'trader' | 'account'>('trader');
  const [subTab, setSubTab] = useState<'overview' | 'open' | 'closed'>('overview');
  const [editSettings, setEditSettings] = useState(false);
  const [editData, setEditData] = useState({ tradeAmount: '', maxPerMarket: '' });
  const [newBot, setNewBot] = useState({ name: '', address: '', balance: '1000', tradeAmount: '50', maxPerMarket: '200' });

  const selectedBot = bots.find(b => b.id === selectedBotId);

  // Load bots
  useEffect(() => {
    const loaded = loadBots();
    setBots(loaded);
    if (loaded.length > 0 && !selectedBotId) setSelectedBotId(loaded[0].id);
    else setLoading(false);
  }, []);

  // Load all data when bot changes
  useEffect(() => {
    if (!selectedBot) return;
    loadAll(selectedBot);
  }, [selectedBotId]);

  const loadAll = useCallback(async (bot: BotInstance) => {
    setLoading(true);
    try {
      const [stats, open, closed, perf, sim] = await Promise.all([
        getTraderStats(bot.traderAddress),
        getTraderOpenPositions(bot.traderAddress),
        getTraderClosedPositions(bot.traderAddress, 100),
        getTraderPerfData(bot.traderAddress),
        runSimulation(bot.traderAddress, bot.initialBalance, bot.tradeAmount, bot.maxPerMarket),
      ]);
      setTraderStats(stats);
      setTraderOpenPos(open);
      setTraderClosedPos(closed);
      setTraderPerf(perf);
      setSimResult(sim);
      // Update balance
      const updated = bots.map(b => b.id === bot.id ? { ...b, virtualBalance: sim.balance } : b);
      setBots(updated);
      saveBots(updated);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [bots]);

  const handleRefresh = useCallback(() => {
    if (selectedBot) loadAll(selectedBot);
  }, [selectedBot, loadAll]);

  const handleAddBot = (e: React.FormEvent) => {
    e.preventDefault();
    const bot: BotInstance = {
      id: Math.random().toString(36).substring(7),
      name: newBot.name,
      traderAddress: newBot.address,
      status: 'active',
      virtualBalance: Number(newBot.balance) || 1000,
      initialBalance: Number(newBot.balance) || 1000,
      tradeAmount: Number(newBot.tradeAmount) || 50,
      maxPerMarket: Number(newBot.maxPerMarket) || 200,
      createdAt: new Date().toISOString(),
    };
    const updated = [...bots, bot];
    setBots(updated);
    saveBots(updated);
    setIsAddingBot(false);
    setNewBot({ name: '', address: '', balance: '1000', tradeAmount: '50', maxPerMarket: '200' });
    setSelectedBotId(bot.id);
  };

  const deleteBot = (id: string) => {
    const updated = bots.filter(b => b.id !== id);
    setBots(updated);
    saveBots(updated);
    if (selectedBotId === id) setSelectedBotId(updated[0]?.id || null);
  };

  const saveSettings = () => {
    if (!selectedBot) return;
    const updated = bots.map(b => b.id === selectedBot.id ? {
      ...b, tradeAmount: Number(editData.tradeAmount) || 50, maxPerMarket: Number(editData.maxPerMarket) || 200
    } : b);
    setBots(updated);
    saveBots(updated);
    setEditSettings(false);
    loadAll({ ...updated.find(b => b.id === selectedBot.id)!, tradeAmount: Number(editData.tradeAmount) || 50, maxPerMarket: Number(editData.maxPerMarket) || 200 });
  };

  return (
    <div className="min-h-screen flex flex-col font-sans bg-[#0a0a0a] text-white">
      {/* Header */}
      <header className="h-14 border-b border-zinc-800/50 flex items-center justify-between px-4 md:px-6 bg-zinc-950/50 backdrop-blur-md sticky top-0 z-40">
        <div className="flex items-center gap-3">
          <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className="md:hidden p-1.5 hover:bg-zinc-800 rounded-lg">
            <Activity className="w-4 h-4" />
          </button>
          <div className="w-7 h-7 bg-white rounded-lg flex items-center justify-center">
            <Bot className="text-black w-4 h-4" />
          </div>
          <h1 className="text-sm font-semibold tracking-tight">PolySim</h1>
        </div>
        <button
          onClick={() => setIsAddingBot(true)}
          className="flex items-center gap-1.5 bg-white text-black px-3 py-1.5 rounded-full text-xs font-medium hover:bg-zinc-200 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">New Bot</span>
        </button>
      </header>

      <div className="flex flex-1 overflow-hidden relative">
        {/* Sidebar */}
        <aside className={cn(
          "fixed inset-y-0 left-0 z-30 w-64 border-r border-zinc-800/50 flex flex-col bg-zinc-950 transition-transform duration-300 md:relative md:translate-x-0",
          isSidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}>
          <div className="p-3 border-b border-zinc-800/50">
            <h2 className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest mb-2">Bots</h2>
            <div className="space-y-0.5">
              {bots.map(bot => (
                <button key={bot.id} onClick={() => { setSelectedBotId(bot.id); setIsSidebarOpen(false); }}
                  className={cn("w-full flex items-center justify-between p-2.5 rounded-lg transition-all text-left",
                    selectedBotId === bot.id ? "bg-zinc-900 border border-zinc-800" : "hover:bg-zinc-900/50 border border-transparent"
                  )}
                >
                  <div className="overflow-hidden">
                    <p className="text-xs font-medium truncate">{bot.name}</p>
                    <p className="text-[9px] text-zinc-600 font-mono">{formatAddress(bot.traderAddress)}</p>
                  </div>
                </button>
              ))}
              {!bots.length && <p className="text-xs text-zinc-600 text-center py-4">No bots yet</p>}
            </div>
          </div>
          <div className="mt-auto p-3 border-t border-zinc-800/50">
            <div className="p-3 rounded-xl bg-zinc-900/50 border border-zinc-800/50">
              <p className="text-[9px] text-zinc-600 mb-0.5">Total Equity</p>
              <p className="text-base font-bold font-mono">{formatCurrency(bots.reduce((a, b) => a + b.virtualBalance, 0))}</p>
            </div>
          </div>
        </aside>

        {isSidebarOpen && <div className="fixed inset-0 bg-black/50 z-20 md:hidden" onClick={() => setIsSidebarOpen(false)} />}

        {/* Main */}
        <main className="flex-1 overflow-y-auto bg-[#0a0a0a]">
          {!selectedBot ? (
            <div className="h-full flex flex-col items-center justify-center text-center space-y-4 py-20">
              <div className="w-16 h-16 bg-zinc-900 rounded-2xl flex items-center justify-center border border-zinc-800">
                <Bot className="w-8 h-8 text-zinc-600" />
              </div>
              <h2 className="text-xl font-bold">No Bot Selected</h2>
              <p className="text-sm text-zinc-600 max-w-xs">Create a bot to start simulating copy trades.</p>
              <button onClick={() => setIsAddingBot(true)} className="bg-white text-black px-5 py-2 rounded-full text-sm font-medium hover:bg-zinc-200 transition-colors">
                Create Your First Bot
              </button>
            </div>
          ) : loading ? (
            <div className="p-6">
              <LoadingBlock text="Loading trader data and running simulation..." />
            </div>
          ) : (
            <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-5">
              {/* Bot Header */}
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <h2 className="text-xl font-bold tracking-tight">{selectedBot.name}</h2>
                    <span className="px-1.5 py-0.5 rounded bg-green-500/10 text-green-500 text-[9px] font-bold uppercase">Active</span>
                  </div>
                  <div className="flex items-center gap-3 text-zinc-500 text-xs">
                    <div className="flex items-center gap-1">
                      <User className="w-3 h-3" />
                      <span className="font-mono">{formatAddress(selectedBot.traderAddress)}</span>
                    </div>
                    <a href={`https://polymarket.com/profile/${selectedBot.traderAddress}`} target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                </div>
                <div className="flex gap-1.5 shrink-0">
                  <button onClick={handleRefresh} className="p-2 rounded-lg border border-zinc-800 hover:bg-zinc-900 transition-colors" title="Refresh">
                    <RefreshCw className="w-4 h-4 text-zinc-500" />
                  </button>
                  <button onClick={() => {
                    setEditData({ tradeAmount: String(selectedBot.tradeAmount), maxPerMarket: String(selectedBot.maxPerMarket) });
                    setEditSettings(true);
                  }} className="p-2 rounded-lg border border-zinc-800 hover:bg-zinc-900 transition-colors" title="Settings">
                    <Target className="w-4 h-4 text-zinc-500" />
                  </button>
                  <button onClick={() => deleteBot(selectedBot.id)} className="p-2 rounded-lg border border-zinc-800 hover:bg-red-500/10 transition-colors" title="Delete">
                    <Trash2 className="w-4 h-4 text-zinc-500" />
                  </button>
                </div>
              </div>

              {/* Risk Controls Bar */}
              <div className="flex items-center gap-4 px-3 py-2 rounded-xl bg-zinc-900/50 border border-zinc-800/50">
                <div className="flex items-center gap-1.5 text-[10px] text-zinc-500">
                  <Clock className="w-3 h-3" />
                  <span>Risk:</span>
                </div>
                <span className="text-xs font-mono text-zinc-300">${selectedBot.tradeAmount}/trade</span>
                <span className="text-zinc-700">·</span>
                <span className="text-xs font-mono text-zinc-300">Max ${selectedBot.maxPerMarket}/market</span>
                <span className="text-zinc-700">·</span>
                <span className="text-xs font-mono text-zinc-300">Start ${selectedBot.initialBalance}</span>
              </div>

              {/* Main Tabs */}
              <div className="flex border-b border-zinc-800/50">
                <button
                  onClick={() => { setMainTab('trader'); setSubTab('overview'); }}
                  className={cn("px-3 py-2 text-xs font-medium border-b transition-colors",
                    mainTab === 'trader' ? "text-white border-white" : "text-zinc-600 border-transparent hover:text-zinc-400"
                  )}
                >
                  Trader Data
                </button>
                <button
                  onClick={() => { setMainTab('account'); setSubTab('overview'); }}
                  className={cn("px-3 py-2 text-xs font-medium border-b transition-colors",
                    mainTab === 'account' ? "text-white border-white" : "text-zinc-600 border-transparent hover:text-zinc-400"
                  )}
                >
                  Our Account
                </button>
              </div>

              {/* ===== TRADER DATA ===== */}
              {mainTab === 'trader' && (
                <>
                  {traderStats && (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <MiniStat label="30d PnL" value={<PnLBadge value={traderStats.realizedPnl30d} />} />
                      <MiniStat label="7d PnL" value={<PnLBadge value={traderStats.realizedPnl7d} />} />
                      <MiniStat label="Win Rate" value={`${traderStats.winRate}%`} sub={`${traderStats.wins}W / ${traderStats.losses}L`} />
                      <MiniStat label="Total Trades" value={traderStats.totalTrades} sub={`Avg ${formatCurrency(traderStats.avgPnlPerTrade)}/trade`} />
                    </div>
                  )}

                  {/* Sub-tabs */}
                  <div className="flex border-b border-zinc-800/50 -mt-1">
                    {[
                      { key: 'overview' as const, label: 'Performance', icon: TrendingUp },
                      { key: 'open' as const, label: `Open (${traderOpenPos.length})`, icon: Eye },
                      { key: 'closed' as const, label: `Closed (${traderClosedPos.length})`, icon: Clock },
                    ].map(t => (
                      <button key={t.key} onClick={() => setSubTab(t.key)}
                        className={cn("flex items-center gap-1.5 px-3 py-2 text-[10px] font-medium border-b transition-colors uppercase tracking-wider",
                          subTab === t.key ? "text-white border-white" : "text-zinc-600 border-transparent hover:text-zinc-400"
                        )}
                      >
                        <t.icon className="w-3 h-3" />
                        {t.label}
                      </button>
                    ))}
                  </div>

                  <div className="min-h-[300px]">
                    {subTab === 'overview' && traderPerf.length > 0 && (
                      <div>
                        <SectionHeader title="Cumulative PnL Over Time" subtitle={`Based on ${traderPerf.length} closed positions`} />
                        <PerfChart data={traderPerf} color="#ffffff" />
                      </div>
                    )}
                    {subTab === 'open' && (
                      <div className="border border-zinc-800/50 rounded-xl overflow-hidden">
                        <OpenPositionsTable positions={traderOpenPos} />
                      </div>
                    )}
                    {subTab === 'closed' && (
                      <div className="border border-zinc-800/50 rounded-xl overflow-hidden">
                        <ClosedPositionsTable positions={traderClosedPos} />
                      </div>
                    )}
                  </div>
                </>
              )}

              {/* ===== OUR ACCOUNT ===== */}
              {mainTab === 'account' && (
                <>
                  {simResult && (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <MiniStat label="Our Balance" value={formatCurrency(simResult.balance)} sub={`Started: ${formatCurrency(selectedBot.initialBalance)}`} />
                      <MiniStat label="Our PnL" value={<PnLBadge value={simResult.pnlAll} />} sub={`30d: ${formatCurrency(simResult.pnl30d)}`} />
                      <MiniStat label="Win Rate" value={`${simResult.winRate}%`} sub={`${simResult.wins}W / ${simResult.losses}L`} />
                      <MiniStat label="Trades Copied" value={simResult.totalTrades} sub={`vs their ${traderStats?.totalTrades || 0}`} />
                    </div>
                  )}

                  {/* Sub-tabs for account */}
                  <div className="flex border-b border-zinc-800/50 -mt-1">
                    {[
                      { key: 'overview' as const, label: 'Comparison', icon: ArrowRight },
                      { key: 'closed' as const, label: `Our Trades (${simResult?.trades.length || 0})`, icon: Clock },
                    ].map(t => (
                      <button key={t.key} onClick={() => setSubTab(t.key)}
                        className={cn("flex items-center gap-1.5 px-3 py-2 text-[10px] font-medium border-b transition-colors uppercase tracking-wider",
                          subTab === t.key ? "text-white border-white" : "text-zinc-600 border-transparent hover:text-zinc-400"
                        )}
                      >
                        <t.icon className="w-3 h-3" />
                        {t.label}
                      </button>
                    ))}
                  </div>

                  <div className="min-h-[300px]">
                    {subTab === 'overview' && simResult && traderPerf.length > 0 && (
                      <div>
                        <SectionHeader title="Balance vs Trader PnL" subtitle="White = our balance · Grey dashed = trader cumulative PnL" />
                        <ComparisonChart our={simResult.perfData} theirs={traderPerf} />
                      </div>
                    )}
                    {subTab === 'closed' && (
                      <div className="border border-zinc-800/50 rounded-xl overflow-hidden">
                        {simResult ? <SimTradesTable trades={simResult.trades} /> : <LoadingBlock text="Loading..." />}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </main>
      </div>

      {/* ===== MODALS ===== */}
      <AnimatePresence>
        {isAddingBot && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setIsAddingBot(false)} className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, scale: 0.96, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: 12 }} className="relative w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-2xl p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-base font-bold">New Bot</h3>
                <button onClick={() => setIsAddingBot(false)} className="p-1 hover:bg-zinc-800 rounded-lg"><X className="w-4 h-4 text-zinc-500" /></button>
              </div>
              <form onSubmit={handleAddBot} className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[9px] font-bold text-zinc-600 uppercase tracking-wider ml-1">Name</label>
                    <input type="text" required placeholder="My Bot" className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-zinc-600 transition-colors mt-1" value={newBot.name} onChange={e => setNewBot({ ...newBot, name: e.target.value })} />
                  </div>
                  <div>
                    <label className="text-[9px] font-bold text-zinc-600 uppercase tracking-wider ml-1">Balance (USDC)</label>
                    <input type="number" required className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-zinc-600 transition-colors mt-1" value={newBot.balance} onChange={e => setNewBot({ ...newBot, balance: e.target.value })} />
                  </div>
                </div>
                <div>
                  <label className="text-[9px] font-bold text-zinc-600 uppercase tracking-wider ml-1">Trader Address</label>
                  <input type="text" required placeholder="0x..." className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-zinc-600 transition-colors mt-1" value={newBot.address} onChange={e => setNewBot({ ...newBot, address: e.target.value })} />
                </div>
                <div className="p-3 rounded-xl bg-zinc-950 border border-zinc-800/50 space-y-3">
                  <p className="text-[9px] font-bold text-zinc-600 uppercase tracking-widest">Risk</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[9px] text-zinc-500 ml-1">Per Trade</label>
                      <input type="number" required className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-zinc-600 mt-1 transition-colors" value={newBot.tradeAmount} onChange={e => setNewBot({ ...newBot, tradeAmount: e.target.value })} />
                    </div>
                    <div>
                      <label className="text-[9px] text-zinc-500 ml-1">Max/Market</label>
                      <input type="number" required className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-zinc-600 mt-1 transition-colors" value={newBot.maxPerMarket} onChange={e => setNewBot({ ...newBot, maxPerMarket: e.target.value })} />
                    </div>
                  </div>
                </div>
                <div className="pt-2 flex gap-2">
                  <button type="button" onClick={() => setIsAddingBot(false)} className="flex-1 px-4 py-2.5 rounded-lg border border-zinc-800 text-sm font-medium hover:bg-zinc-800 transition-colors">Cancel</button>
                  <button type="submit" className="flex-1 bg-white text-black px-4 py-2.5 rounded-lg text-sm font-bold hover:bg-zinc-200 transition-colors">Create Bot</button>
                </div>
              </form>
            </motion.div>
          </div>
        )}

        {editSettings && selectedBot && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setEditSettings(false)} className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, scale: 0.96, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: 12 }} className="relative w-full max-w-sm bg-zinc-900 border border-zinc-800 rounded-2xl p-6 shadow-2xl">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base font-bold">Risk Settings</h3>
                <button onClick={() => setEditSettings(false)} className="p-1 hover:bg-zinc-800 rounded-lg"><X className="w-4 h-4 text-zinc-500" /></button>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="text-[9px] font-bold text-zinc-600 uppercase tracking-wider ml-1">Per Trade (USDC)</label>
                  <input type="number" className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-zinc-600 transition-colors mt-1" value={editData.tradeAmount} onChange={e => setEditData({ ...editData, tradeAmount: e.target.value })} />
                </div>
                <div>
                  <label className="text-[9px] font-bold text-zinc-600 uppercase tracking-wider ml-1">Max Per Market (USDC)</label>
                  <input type="number" className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-zinc-600 transition-colors mt-1" value={editData.maxPerMarket} onChange={e => setEditData({ ...editData, maxPerMarket: e.target.value })} />
                </div>
                <div className="pt-2 flex gap-2">
                  <button onClick={() => setEditSettings(false)} className="flex-1 px-4 py-2.5 rounded-lg border border-zinc-800 text-sm font-medium hover:bg-zinc-800 transition-colors">Cancel</button>
                  <button onClick={saveSettings} className="flex-1 bg-white text-black px-4 py-2.5 rounded-lg text-sm font-bold hover:bg-zinc-200 transition-colors">Save</button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
