/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Activity, Plus, Trash2, RefreshCw, ExternalLink,
  ChevronRight, Bot, User, BarChart3, TrendingUp,
  Target, Clock, Eye, X, Play, Square, AlertTriangle
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer
} from 'recharts';
import { cn, formatCurrency, formatAddress } from './lib/utils';
import {
  getTraderStats, getTraderOpenPositions, getTraderClosedPositions,
  getTraderPerfData, runHistoricalSimulation, clearCache,
  getLiveStats, applyLiveTrade,
  TraderStats, PolymarketPosition, LiveState
} from './services/polymarket';

// ---- Types ----
interface BotInstance {
  id: string;
  name: string;
  traderAddress: string;
  status: 'active' | 'paused' | 'live';
  virtualBalance: number;
  initialBalance: number;
  tradeAmount: number;
  maxPerMarket: number;
  createdAt: string;
}

// ---- Constants ----
const BOTS_KEY = 'polysim_bots';
const LIVE_KEY = (id: string) => `polysim_live_${id}`;
const loadBots = (): BotInstance[] => {
  try { return JSON.parse(localStorage.getItem(BOTS_KEY) || '[]'); } catch { return []; }
};
const saveBots = (b: BotInstance[]) => localStorage.setItem(BOTS_KEY, JSON.stringify(b));
const loadLiveState = (botId: string): LiveState | null => {
  try { return JSON.parse(localStorage.getItem(LIVE_KEY(botId)) || 'null'); } catch { return null; }
};
const saveLiveState = (botId: string, s: LiveState) => localStorage.setItem(LIVE_KEY(botId), JSON.stringify(s));
const clearLiveState = (botId: string) => localStorage.removeItem(LIVE_KEY(botId));

// ---- Helpers ----
function timeAgo(ts: number): string {
  const secs = (Date.now() / 1000) - ts;
  if (secs < 60) return `${Math.floor(secs)}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

function lithuanianDate(ts: number): string {
  return new Date(ts).toLocaleString('en-GB', {
    timeZone: 'Europe/Vilnius',
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

// ---- Reusable Components ----
function PnLBadge({ value, small }: { value: number; small?: boolean }) {
  const positive = value >= 0;
  return (
    <span className={cn(
      "font-mono font-bold inline-flex items-center gap-0.5",
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

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-4">
      <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
      {subtitle && <p className="text-xs text-zinc-600 mt-0.5">{subtitle}</p>}
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

function ErrorBlock({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="text-center py-16">
      <AlertTriangle className="w-8 h-8 mx-auto mb-3 text-red-500/60" />
      <p className="text-sm text-zinc-400 mb-4">{message}</p>
      <button onClick={onRetry} className="px-4 py-2 rounded-lg bg-zinc-800 text-xs font-medium hover:bg-zinc-700 transition-colors">
        Retry
      </button>
    </div>
  );
}

// ---- PnL Area Chart (green/red based on direction) ----
function PnLChart({ data }: { data: { time: number; value: number; dateStr: string }[] }) {
  if (!data.length) return <div className="text-center py-12 text-zinc-600 text-sm">No data</div>;
  const vals = data.map(d => d.value);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const pad = Math.max((max - min) * 0.1, 5);
  const endVal = vals[vals.length - 1];
  const isUp = data.length >= 2 ? endVal >= vals[0] : endVal >= 0;
  const color = isUp ? '#22c55e' : '#ef4444';
  const domainMin = max === min ? min - 50 : Math.floor(min - pad);
  const domainMax = max === min ? max + 50 : Math.ceil(max + pad);
  const showEvery = Math.max(1, Math.floor(data.length / 6));

  return (
    <div className="h-[250px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data}>
          <defs>
            <linearGradient id="pnlGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={color} stopOpacity={0.15} />
              <stop offset="95%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#1a1a1a" vertical={false} />
          <XAxis dataKey="dateStr" stroke="#444" fontSize={9} tickLine={false} axisLine={false} interval={showEvery} />
          <YAxis stroke="#444" fontSize={9} tickLine={false} axisLine={false} domain={[domainMin, domainMax]} tickFormatter={(v) => `$${v}`} width={55} />
          <Tooltip contentStyle={{ backgroundColor: '#111', border: '1px solid #222', borderRadius: '8px' }}
            formatter={(val: number) => [formatCurrency(val), 'Cumulative PnL']} labelStyle={{ color: '#666', fontSize: 10 }} />
          <Area type="monotone" dataKey="value" stroke={color} strokeWidth={1.5} fill="url(#pnlGrad)" isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---- Open Positions Table ----
function OpenPositionsTable({ positions }: { positions: PolymarketPosition[] }) {
  if (!positions.length) return <div className="text-center py-8 text-zinc-600 text-sm">No open positions</div>;
  return (
    <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
      <table className="w-full text-left min-w-[500px]">
        <thead>
          <tr className="text-[10px] font-bold text-zinc-600 uppercase tracking-wider border-b border-zinc-800">
            <th className="px-3 py-2.5">Market</th>
            <th className="px-3 py-2.5 text-right">Side</th>
            <th className="px-3 py-2.5 text-right">Size</th>
            <th className="px-3 py-2.5 text-right hidden sm:table-cell">Avg</th>
            <th className="px-3 py-2.5 text-right hidden sm:table-cell">Cur</th>
            <th className="px-3 py-2.5 text-right">U.PnL</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800/50">
          {positions.map((p) => {
            const side = p.outcomeIndex === 0 ? 'YES' : 'NO';
            return (
              <tr key={p.id} className="hover:bg-zinc-900/30 transition-colors">
                <td className="px-3 py-2">
                  <p className="text-xs sm:text-sm font-medium line-clamp-1 max-w-[160px] sm:max-w-xs">{p.title}</p>
                </td>
                <td className="px-3 py-2 text-right">
                  <span className={cn("px-1.5 py-0.5 rounded text-[9px] font-bold",
                    side === 'YES' ? "bg-green-500/10 text-green-500" : "bg-red-500/10 text-red-500"
                  )}>{side}</span>
                </td>
                <td className="px-3 py-2 text-xs font-mono text-right">${p.size.toFixed(2)}</td>
                <td className="px-3 py-2 text-xs font-mono text-right hidden sm:table-cell">{(p.avgPrice * 100).toFixed(1)}¢</td>
                <td className="px-3 py-2 text-xs font-mono text-right hidden sm:table-cell">{(p.currentPrice || 0) > 0 ? ((p.currentPrice || 0) * 100).toFixed(1) + '¢' : '—'}</td>
                <td className="px-3 py-2 text-right"><PnLBadge value={p.cashPnl || 0} small /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---- Closed Positions Table ----
function ClosedPositionsTable({ positions }: { positions: PolymarketPosition[] }) {
  if (!positions.length) return <div className="text-center py-8 text-zinc-600 text-sm">No closed positions</div>;
  return (
    <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
      <table className="w-full text-left min-w-[500px]">
        <thead>
          <tr className="text-[10px] font-bold text-zinc-600 uppercase tracking-wider border-b border-zinc-800">
            <th className="px-3 py-2.5">Market</th>
            <th className="px-3 py-2.5 text-right">Side</th>
            <th className="px-3 py-2.5 text-right hidden sm:table-cell">Size</th>
            <th className="px-3 py-2.5 text-right">PnL</th>
            <th className="px-3 py-2.5 text-right hidden sm:table-cell">Date</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800/50">
          {positions.map((p) => {
            const side = p.outcomeIndex === 0 ? 'YES' : 'NO';
            return (
              <tr key={p.id} className="hover:bg-zinc-900/30 transition-colors">
                <td className="px-3 py-2">
                  <p className="text-xs sm:text-sm font-medium line-clamp-1 max-w-[160px] sm:max-w-xs">{p.title}</p>
                </td>
                <td className="px-3 py-2 text-right">
                  <span className={cn("px-1.5 py-0.5 rounded text-[9px] font-bold",
                    side === 'YES' ? "bg-green-500/10 text-green-500" : "bg-red-500/10 text-red-500"
                  )}>{side}</span>
                </td>
                <td className="px-3 py-2 text-xs font-mono text-right hidden sm:table-cell">${p.size.toFixed(2)}</td>
                <td className="px-3 py-2 text-right"><PnLBadge value={p.realizedPnl} small /></td>
                <td className="px-3 py-2 text-[10px] sm:text-xs text-zinc-600 text-right font-mono hidden sm:table-cell">
                  {lithuanianDate(p.timestamp * 1000)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---- Trades Table (for both sim and live) ----
function TradesTable({ trades }: { trades: any[] }) {
  if (!trades.length) return <div className="text-center py-8 text-zinc-600 text-sm">No trades yet</div>;
  return (
    <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
      <table className="w-full text-left min-w-[400px]">
        <thead>
          <tr className="text-[10px] font-bold text-zinc-600 uppercase tracking-wider border-b border-zinc-800">
            <th className="px-3 py-2.5">Market</th>
            <th className="px-3 py-2.5 text-right">Side</th>
            <th className="px-3 py-2.5 text-right">PnL</th>
            <th className="px-3 py-2.5 text-right hidden sm:table-cell">ROI</th>
            <th className="px-3 py-2.5 text-right hidden sm:table-cell">Balance</th>
            <th className="px-3 py-2.5 text-right hidden sm:table-cell">Time</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800/50">
          {[...trades].reverse().map((t) => (
            <tr key={t.id} className="hover:bg-zinc-900/30 transition-colors">
              <td className="px-3 py-2">
                <p className="text-xs sm:text-sm font-medium line-clamp-1 max-w-[120px] sm:max-w-xs">{t.title}</p>
              </td>
              <td className="px-3 py-2 text-right">
                <span className={cn("px-1.5 py-0.5 rounded text-[9px] font-bold",
                  t.side === 'YES' ? "bg-green-500/10 text-green-500" : "bg-red-500/10 text-red-500"
                )}>{t.side}</span>
              </td>
              <td className="px-3 py-2 text-right"><PnLBadge value={t.profit} small /></td>
              <td className="px-3 py-2 text-xs font-mono text-right hidden sm:table-cell">{t.roi >= 0 ? '+' : ''}{t.roi.toFixed(1)}%</td>
              <td className="px-3 py-2 text-xs font-mono text-right hidden sm:table-cell">${t.balanceAfter.toFixed(2)}</td>
              <td className="px-3 py-2 text-[10px] text-zinc-600 text-right hidden sm:table-cell">{t.dateStr}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---- Live Account Stats ----
function LiveAccountStats({ liveState, startBalance }: { liveState: LiveState; startBalance: number }) {
  const stats = getLiveStats(liveState);
  const lastTrade = liveState.trades.length > 0 ? liveState.trades[liveState.trades.length - 1] : null;
  return (
    <>
      <MiniStat label="Balance" value={formatCurrency(stats.balance)} sub={`Start: ${formatCurrency(startBalance)}`} />
      <MiniStat label="PnL" value={<PnLBadge value={stats.pnlAll} small />} sub={`24h: ${formatCurrency(stats.pnl24h)}`} />
      <MiniStat label="Win Rate" value={`${stats.winRate}%`} sub={`${stats.wins}W / ${stats.losses}L`} />
      <MiniStat label="Trades" value={stats.totalTrades} sub={lastTrade ? timeAgo(lastTrade.time) : '—'} />
    </>
  );
}

// ---- Main App ----
export default function App() {
  // Bot management
  const [bots, setBots] = useState<BotInstance[]>([]);
  const [selectedBotId, setSelectedBotId] = useState<string | null>(null);
  const selectedBot = bots.find(b => b.id === selectedBotId);

  // Trader data
  const [traderStats, setTraderStats] = useState<TraderStats | null>(null);
  const [traderOpenPos, setTraderOpenPos] = useState<PolymarketPosition[]>([]);
  const [traderClosedPos, setTraderClosedPos] = useState<PolymarketPosition[]>([]);
  const [traderPerf, setTraderPerf] = useState<{ time: number; value: number; dateStr: string }[]>([]);
  const [traderSubTab, setTraderSubTab] = useState<'chart' | 'open' | 'closed'>('chart');

  // Mode
  const [simMode, setSimMode] = useState<'live' | 'historical'>('live');

  // Historical sim
  const [simResult, setSimResult] = useState<any>(null);
  const [simTradeCount, setSimTradeCount] = useState<string>('');
  const [simAllTrades, setSimAllTrades] = useState(false);
  const [simRunning, setSimRunning] = useState(false);

  // Live copy trading
  const [liveState, setLiveState] = useState<LiveState | null>(null);
  const [liveRunning, setLiveRunning] = useState(false);
  const liveLastCheckRef = useRef<number>(0);
  const liveIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const POLL_MS = 30_000;

  // UI
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [isAddingBot, setIsAddingBot] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [editSettings, setEditSettings] = useState(false);
  const [editData, setEditData] = useState({ tradeAmount: '', maxPerMarket: '' });
  const [newBot, setNewBot] = useState({ name: '', address: '', balance: '1000', tradeAmount: '50', maxPerMarket: '200' });

  // Load bots
  useEffect(() => {
    const loaded = loadBots();
    setBots(loaded);
    if (loaded.length > 0 && !selectedBotId) setSelectedBotId(loaded[0].id);
    else setLoading(false);
  }, []);

  // Load trader data
  const loadAll = useCallback(async (bot: BotInstance) => {
    setLoading(true);
    setError(null);
    try {
      const [stats, open, closed, perf] = await Promise.all([
        getTraderStats(bot.traderAddress),
        getTraderOpenPositions(bot.traderAddress),
        getTraderClosedPositions(bot.traderAddress, 100),
        getTraderPerfData(bot.traderAddress),
      ]);
      setTraderStats(stats);
      setTraderOpenPos(open);
      setTraderClosedPos(closed);
      setTraderPerf(perf);
      setLastRefresh(new Date());
      // Restore live state if exists
      const ls = loadLiveState(bot.id);
      if (ls && ls.trades.length > 0) {
        setLiveState(ls);
        const st = getLiveStats(ls);
        const updated = bots.map(b => b.id === bot.id ? { ...b, virtualBalance: st.balance, status: 'live' as const } : b);
        setBots(updated);
        saveBots(updated);
        setLiveRunning(true);
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, [bots]);

  useEffect(() => {
    if (!selectedBot) return;
    loadAll(selectedBot);
  }, [selectedBotId]);

  // Live polling
  useEffect(() => {
    if (!liveRunning || !selectedBot) {
      if (liveIntervalRef.current) { clearInterval(liveIntervalRef.current); liveIntervalRef.current = null; }
      return;
    }

    const poll = async () => {
      try {
        const closed = await getTraderClosedPositions(selectedBot.traderAddress, 20);
        if (closed.length === 0) return;
        const cur = loadLiveState(selectedBot.id);
        if (!cur) return;
        const lastTs = cur.trades.length > 0 ? Math.max(...cur.trades.map(t => t.time)) : 0;
        let added = 0;
        for (const p of closed) {
          if (p.timestamp <= Math.max(lastTs, liveLastCheckRef.current)) continue;
          const posData = {
            id: p.id || p.conditionId,
            title: p.title,
            outcomeIndex: p.outcomeIndex,
            totalBought: p.size,
            realizedPnl: p.realizedPnl,
            conditionId: p.conditionId,
            timestamp: p.timestamp,
          };
          const result = applyLiveTrade(posData, cur, selectedBot.tradeAmount, selectedBot.maxPerMarket);
          if (result) added++;
        }
        if (added > 0) {
          saveLiveState(selectedBot.id, cur);
          setLiveState({ ...cur, trades: [...cur.trades] });
          const st = getLiveStats(cur);
          const updated = bots.map(b => b.id === selectedBot.id ? { ...b, virtualBalance: st.balance } : b);
          setBots(updated);
          saveBots(updated);
        }
      } catch (e) { console.error('Live poll:', e); }
    };

    liveIntervalRef.current = setInterval(poll, POLL_MS);
    return () => { if (liveIntervalRef.current) clearInterval(liveIntervalRef.current); };
  }, [liveRunning, selectedBotId, selectedBot?.tradeAmount, selectedBot?.maxPerMarket]);

  const handleRefresh = useCallback(async () => {
    if (!selectedBot) return;
    clearCache(selectedBot.traderAddress);
    await loadAll(selectedBot);
  }, [selectedBot, loadAll]);

  const startLive = useCallback(() => {
    if (!selectedBot) return;
    const existing = loadLiveState(selectedBot.id);
    const ls = existing || { balance: selectedBot.initialBalance, trades: [], totalWins: 0, totalLosses: 0, _exposure: {} };
    setLiveState(ls);
    saveLiveState(selectedBot.id, ls);
    liveLastCheckRef.current = Math.floor(Date.now() / 1000);
    setLiveRunning(true);
    const updated = bots.map(b => b.id === selectedBot.id ? { ...b, status: 'live' as const } : b);
    setBots(updated);
    saveBots(updated);
  }, [selectedBot, bots]);

  const stopLive = useCallback(() => {
    setLiveRunning(false);
    if (liveIntervalRef.current) { clearInterval(liveIntervalRef.current); liveIntervalRef.current = null; }
    if (selectedBot) {
      const updated = bots.map(b => b.id === selectedBot.id ? { ...b, status: 'paused' as const } : b);
      setBots(updated);
      saveBots(updated);
    }
  }, [selectedBot, bots]);

  const resetLive = useCallback(() => {
    if (!selectedBot) return;
    setLiveRunning(false);
    clearLiveState(selectedBot.id);
    setLiveState(null);
    const updated = bots.map(b => b.id === selectedBot.id ? { ...b, status: 'active' as const, virtualBalance: b.initialBalance } : b);
    setBots(updated);
    saveBots(updated);
  }, [selectedBot, bots]);

  const runSimulation = useCallback(async () => {
    if (!selectedBot) return;
    setSimRunning(true);
    setError(null);
    try {
      const { runHistoricalSimulation } = await import('./services/polymarket');
      const limit = simAllTrades ? undefined : (parseInt(simTradeCount) || 100);
      const result = await runHistoricalSimulation(
        selectedBot.traderAddress, selectedBot.initialBalance,
        selectedBot.tradeAmount, selectedBot.maxPerMarket, limit
      );
      setSimResult(result);
    } catch (e: any) { setError(e?.message || 'Simulation failed'); } finally { setSimRunning(false); }
  }, [selectedBot, simTradeCount, simAllTrades]);

  // Bot CRUD
  const handleAddBot = (e: React.FormEvent) => {
    e.preventDefault();
    const bot: BotInstance = {
      id: Math.random().toString(36).substring(7), name: newBot.name,
      traderAddress: newBot.address, status: 'active',
      virtualBalance: Number(newBot.balance) || 1000,
      initialBalance: Number(newBot.balance) || 1000,
      tradeAmount: Number(newBot.tradeAmount) || 50,
      maxPerMarket: Number(newBot.maxPerMarket) || 200,
      createdAt: new Date().toISOString(),
    };
    const updated = [...bots, bot];
    setBots(updated); saveBots(updated);
    setIsAddingBot(false);
    setNewBot({ name: '', address: '', balance: '1000', tradeAmount: '50', maxPerMarket: '200' });
    setSelectedBotId(bot.id);
  };

  const deleteBot = (id: string) => {
    clearLiveState(id);
    const updated = bots.filter(b => b.id !== id);
    setBots(updated); saveBots(updated);
    if (selectedBotId === id) setSelectedBotId(updated[0]?.id || null);
  };

  const saveSettings = () => {
    if (!selectedBot) return;
    const updated = bots.map(b => b.id === selectedBot.id ? {
      ...b, tradeAmount: Number(editData.tradeAmount) || 50, maxPerMarket: Number(editData.maxPerMarket) || 200
    } : b);
    setBots(updated); saveBots(updated);
    setEditSettings(false);
  };

  return (
    <div className="min-h-screen flex flex-col font-sans bg-[#0a0a0a] text-white">
      {/* Header */}
      <header className="h-14 border-b border-zinc-800/50 flex items-center justify-between px-4 sm:px-6 bg-zinc-950/50 backdrop-blur-md sticky top-0 z-40">
        <div className="flex items-center gap-3">
          <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className="sm:hidden p-1.5 hover:bg-zinc-800 rounded-lg">
            <ChevronRight className={cn("w-4 h-4 transition-transform", isSidebarOpen ? "rotate-90" : "")} />
          </button>
          <div className="w-7 h-7 bg-white rounded-lg flex items-center justify-center">
            <Bot className="text-black w-4 h-4" />
          </div>
          <h1 className="text-sm font-semibold tracking-tight">PolySim</h1>
        </div>
        <div className="flex items-center gap-2">
          {lastRefresh && (
            <span className="text-[10px] text-zinc-500 hidden sm:inline">
              {lastRefresh.toLocaleTimeString('en-GB', { timeZone: 'Europe/Vilnius', hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          <button onClick={() => setIsAddingBot(true)} className="flex items-center gap-1.5 bg-white text-black px-3 py-1.5 rounded-full text-xs font-medium hover:bg-zinc-200 transition-colors">
            <Plus className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">New Bot</span>
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden relative">
        {/* Sidebar */}
        <aside className={cn(
          "fixed inset-y-0 left-0 z-30 w-64 border-r border-zinc-800/50 flex flex-col bg-zinc-950 transition-transform duration-300 sm:relative sm:translate-x-0",
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
                  {bot.status === 'live' && <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse shrink-0" />}
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

        {isSidebarOpen && <div className="fixed inset-0 bg-black/50 z-20 sm:hidden" onClick={() => setIsSidebarOpen(false)} />}

        {/* Main Content */}
        <main className="flex-1 overflow-y-auto bg-[#0a0a0a] w-full min-w-0">
          {!selectedBot ? (
            <div className="h-full flex flex-col items-center justify-center text-center space-y-4 py-20 px-4">
              <div className="w-16 h-16 bg-zinc-900 rounded-2xl flex items-center justify-center border border-zinc-800">
                <Bot className="w-8 h-8 text-zinc-600" />
              </div>
              <h2 className="text-xl font-bold">No Bot Selected</h2>
              <p className="text-sm text-zinc-600 max-w-xs">Create a bot to start copy trading.</p>
              <button onClick={() => setIsAddingBot(true)} className="bg-white text-black px-5 py-2 rounded-full text-sm font-medium hover:bg-zinc-200 transition-colors">
                Create Your First Bot
              </button>
            </div>
          ) : loading ? (
            <div className="p-6"><LoadingBlock text="Loading trader data..." /></div>
          ) : error && !traderStats ? (
            <div className="p-6"><ErrorBlock message={error} onRetry={() => loadAll(selectedBot)} /></div>
          ) : (
            <div className="p-4 sm:p-6 max-w-5xl mx-auto w-full space-y-5">
              {/* Bot Header */}
              <div className="flex flex-col sm:flex-row items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h2 className="text-lg sm:text-xl font-bold tracking-tight truncate">{selectedBot.name}</h2>
                    <span className={cn("px-1.5 py-0.5 rounded text-[9px] font-bold uppercase shrink-0",
                      selectedBot.status === 'live' ? "bg-green-500/10 text-green-500" : "bg-zinc-800 text-zinc-400"
                    )}>{selectedBot.status}</span>
                  </div>
                  <div className="flex items-center gap-3 text-zinc-500 text-xs">
                    <div className="flex items-center gap-1 min-w-0">
                      <User className="w-3 h-3 shrink-0" />
                      <span className="font-mono truncate">{formatAddress(selectedBot.traderAddress)}</span>
                    </div>
                    <a href={`https://polymarket.com/profile/${selectedBot.traderAddress}`} target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors shrink-0">
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </div>
                </div>
                <div className="flex gap-1.5 shrink-0">
                  <button onClick={handleRefresh} className="p-2 rounded-lg border border-zinc-800 hover:bg-zinc-900 transition-colors" title="Refresh">
                    <RefreshCw className="w-4 h-4 text-zinc-500" />
                  </button>
                  <button onClick={() => { setEditData({ tradeAmount: String(selectedBot.tradeAmount), maxPerMarket: String(selectedBot.maxPerMarket) }); setEditSettings(true); }} className="p-2 rounded-lg border border-zinc-800 hover:bg-zinc-900 transition-colors" title="Settings">
                    <Target className="w-4 h-4 text-zinc-500" />
                  </button>
                  <button onClick={() => deleteBot(selectedBot.id)} className="p-2 rounded-lg border border-zinc-800 hover:bg-red-500/10 transition-colors" title="Delete">
                    <Trash2 className="w-4 h-4 text-zinc-500" />
                  </button>
                </div>
              </div>

              {/* Risk Bar */}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 rounded-xl bg-zinc-900/50 border border-zinc-800/50 text-xs">
                <span className="text-[10px] text-zinc-500">Risk:</span>
                <span className="font-mono text-zinc-300">${selectedBot.tradeAmount}/trade</span>
                <span className="text-zinc-700">·</span>
                <span className="font-mono text-zinc-300">Max ${selectedBot.maxPerMarket}/mkt</span>
                <span className="text-zinc-700">·</span>
                <span className="font-mono text-zinc-300">Start ${selectedBot.initialBalance}</span>
              </div>

              {/* Mode Toggle + Controls */}
              <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="flex items-center gap-1">
                  <button onClick={() => setSimMode('live')} className={cn("px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
                    simMode === 'live' ? "bg-white text-black" : "bg-zinc-900 text-zinc-500 hover:text-zinc-300"
                  )}>
                    {simMode === 'live' && <Play className="w-3 h-3 inline mr-1" />}
                    Live Copy Trade
                  </button>
                  <button onClick={() => setSimMode('historical')} className={cn("px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
                    simMode === 'historical' ? "bg-white text-black" : "bg-zinc-900 text-zinc-500 hover:text-zinc-300"
                  )}>
                    {simMode === 'historical' && <BarChart3 className="w-3 h-3 inline mr-1" />}
                    Historical Sim
                  </button>
                </div>

                {/* Live controls */}
                {simMode === 'live' && (
                  <div className="flex items-center gap-2 sm:ml-auto">
                    {!liveRunning ? (
                      <button onClick={startLive} className="flex items-center gap-1.5 bg-green-500/10 text-green-500 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-green-500/20 transition-colors">
                        <Play className="w-3 h-3" /> Start Copy Trading
                      </button>
                    ) : (
                      <>
                        <span className="flex items-center gap-1.5 text-[10px] text-green-500">
                          <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                          Live — polling every 30s
                        </span>
                        <button onClick={stopLive} className="flex items-center gap-1.5 bg-red-500/10 text-red-500 px-2 py-1 rounded-lg text-xs font-medium hover:bg-red-500/20 transition-colors">
                          <Square className="w-3 h-3" /> Stop
                        </button>
                      </>
                    )}
                    {liveState && liveState.trades.length > 0 && (
                      <button onClick={resetLive} className="text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors">
                        Reset
                      </button>
                    )}
                  </div>
                )}

                {/* Sim controls */}
                {simMode === 'historical' && (
                  <div className="flex items-center gap-2 sm:ml-auto">
                    <div className="flex items-center gap-1">
                      <input type="number" placeholder="Trades"
                        className={cn("w-20 bg-zinc-900 border rounded-lg px-2 py-1.5 text-xs font-mono focus:outline-none transition-colors",
                          simAllTrades ? "border-zinc-800 text-zinc-700" : "border-zinc-700 text-zinc-300 focus:border-zinc-500"
                        )}
                        value={simTradeCount} onChange={e => { setSimTradeCount(e.target.value); setSimAllTrades(false); }}
                        disabled={simAllTrades} min="1" />
                      <button onClick={() => setSimAllTrades(!simAllTrades)} className={cn("px-2 py-1.5 rounded-lg text-[10px] font-medium border transition-colors",
                        simAllTrades ? "bg-white text-black border-white" : "bg-zinc-900 text-zinc-500 border-zinc-800 hover:text-zinc-300"
                      )}>All</button>
                    </div>
                    <button onClick={runSimulation} disabled={simRunning} className={cn("flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
                      simRunning ? "bg-zinc-800 text-zinc-600" : "bg-white text-black hover:bg-zinc-200"
                    )}>
                      {simRunning ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                      {simRunning ? 'Running...' : 'Run'}
                    </button>
                  </div>
                )}
              </div>

              {/* ===== LIVE MODE ===== */}
              {simMode === 'live' && (
                <>
                  {!liveRunning && !liveState ? (
                    <div className="text-center py-12 text-zinc-600 text-sm">
                      <Play className="w-8 h-8 mx-auto mb-3 text-zinc-700" />
                      Press <span className="text-green-500 font-medium">Start Copy Trading</span> to begin
                    </div>
                  ) : liveState ? (
                    <>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <LiveAccountStats liveState={liveState} startBalance={selectedBot.initialBalance} />
                      </div>
                      {liveState.trades.length > 0 && (
                        <div className="border border-zinc-800/50 rounded-xl p-4">
                          <SectionHeader title="Live PnL" subtitle={`${liveState.trades.length} trades cop${liveState.trades.length === 1 ? 'ied' : 'ied'}`} />
                          <PnLChart data={liveState.trades.map(t => ({ time: t.time * 1000, value: t.balanceAfter, dateStr: t.dateStr }))} />
                        </div>
                      )}
                      {liveState.trades.length > 0 && (
                        <div className="border border-zinc-800/50 rounded-xl overflow-hidden">
                          <SectionHeader title="Live Trades" subtitle="Latest first" />
                          <TradesTable trades={liveState.trades} />
                        </div>
                      )}
                    </>
                  ) : null}
                </>
              )}

              {/* ===== HISTORICAL MODE ===== */}
              {simMode === 'historical' && simResult && (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <MiniStat label="Balance" value={formatCurrency(simResult.balance)} sub={`Start: ${formatCurrency(selectedBot.initialBalance)}`} />
                    <MiniStat label="Total PnL" value={<PnLBadge value={simResult.pnlAll} />} sub={`24h: ${formatCurrency(simResult.pnl24h)}`} />
                    <MiniStat label="Win Rate" value={`${simResult.winRate}%`} sub={`${simResult.wins}W / ${simResult.losses}L`} />
                    <MiniStat label="Trades" value={simResult.totalTrades} sub={`of ${traderStats?.totalTrades || 0} total`} />
                  </div>
                  <div className="border border-zinc-800/50 rounded-xl p-4">
                    <SectionHeader title="Simulated Balance" subtitle={`${simResult.trades.length} trades`} />
                    <PnLChart data={simResult.perfData} />
                  </div>
                  <div className="border border-zinc-800/50 rounded-xl overflow-hidden">
                    <SectionHeader title="Simulated Trades" subtitle="Latest first" />
                    <TradesTable trades={simResult.trades} />
                  </div>
                </>
              )}
              {simMode === 'historical' && !simResult && !simRunning && (
                <div className="text-center py-12 text-zinc-600 text-sm">
                  Configure trade count above and press <span className="text-white font-medium">Run</span>
                </div>
              )}

              {/* ===== TRADER DATA ===== */}
              <div className="border border-zinc-800/50 rounded-xl overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-3">
                  <TrendingUp className="w-4 h-4 text-zinc-500" />
                  <h3 className="text-sm font-semibold">Trader Data</h3>
                </div>
                {traderStats && (
                  <div className="px-4 pb-4 space-y-4">
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                      <MiniStat label="24h PnL" value={<PnLBadge value={traderStats.realizedPnl24h} small />} />
                      <MiniStat label="7d PnL" value={<PnLBadge value={traderStats.realizedPnl7d} small />} />
                      <MiniStat label="30d PnL" value={<PnLBadge value={traderStats.realizedPnl30d} small />} />
                      <MiniStat label="All PnL" value={<PnLBadge value={traderStats.realizedPnlAll} small />} />
                      <MiniStat label="Win Rate" value={`${traderStats.winRate}%`} sub={`${traderStats.wins}W / ${traderStats.losses}L`} />
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <MiniStat label="Trades" value={traderStats.totalTrades} />
                      <MiniStat label="Avg PnL" value={<PnLBadge value={traderStats.avgPnlPerTrade} small />} />
                      <MiniStat label="Last Trade" value={traderStats.lastTradeTs > 0 ? timeAgo(traderStats.lastTradeTs) : '—'} />
                    </div>

                    {/* Sub-tabs */}
                    <div className="flex border-b border-zinc-800/50 -mx-1 px-1">
                      {(['chart', 'open', 'closed'] as const).map(t => (
                        <button key={t} onClick={() => setTraderSubTab(t)}
                          className={cn("px-3 py-1.5 text-[10px] font-medium border-b transition-colors capitalize",
                            traderSubTab === t ? "text-white border-white" : "text-zinc-600 border-transparent hover:text-zinc-400"
                          )}
                        >{t === 'open' ? `Open (${traderOpenPos.length})` : t === 'closed' ? 'Recent' : 'Chart'}</button>
                      ))}
                    </div>

                    {traderSubTab === 'chart' && traderPerf.length > 0 && (
                      <PnLChart data={traderPerf} />
                    )}
                    {traderSubTab === 'open' && (
                      <div className="border border-zinc-800/50 rounded-xl overflow-hidden">
                        <OpenPositionsTable positions={traderOpenPos} />
                      </div>
                    )}
                    {traderSubTab === 'closed' && (
                      <div className="border border-zinc-800/50 rounded-xl overflow-hidden">
                        <ClosedPositionsTable positions={traderClosedPos} />
                      </div>
                    )}
                  </div>
                )}
              </div>
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
                    <input type="text" required placeholder="My Bot" className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-zinc-600 mt-1" value={newBot.name} onChange={e => setNewBot({ ...newBot, name: e.target.value })} />
                  </div>
                  <div>
                    <label className="text-[9px] font-bold text-zinc-600 uppercase tracking-wider ml-1">Balance (USDC)</label>
                    <input type="number" required className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-zinc-600 mt-1" value={newBot.balance} onChange={e => setNewBot({ ...newBot, balance: e.target.value })} />
                  </div>
                </div>
                <div>
                  <label className="text-[9px] font-bold text-zinc-600 uppercase tracking-wider ml-1">Trader Address</label>
                  <input type="text" required placeholder="0x..." className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-zinc-600 mt-1" value={newBot.address} onChange={e => setNewBot({ ...newBot, address: e.target.value })} />
                </div>
                <div className="p-3 rounded-xl bg-zinc-950 border border-zinc-800/50 space-y-3">
                  <p className="text-[9px] font-bold text-zinc-600 uppercase tracking-widest">Risk</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[9px] text-zinc-500 ml-1">Per Trade</label>
                      <input type="number" required className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-zinc-600 mt-1" value={newBot.tradeAmount} onChange={e => setNewBot({ ...newBot, tradeAmount: e.target.value })} />
                    </div>
                    <div>
                      <label className="text-[9px] text-zinc-500 ml-1">Max/Market</label>
                      <input type="number" required className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-zinc-600 mt-1" value={newBot.maxPerMarket} onChange={e => setNewBot({ ...newBot, maxPerMarket: e.target.value })} />
                    </div>
                  </div>
                </div>
                <div className="pt-2 flex gap-2">
                  <button type="button" onClick={() => setIsAddingBot(false)} className="flex-1 px-4 py-2.5 rounded-lg border border-zinc-800 text-sm font-medium hover:bg-zinc-800">Cancel</button>
                  <button type="submit" className="flex-1 bg-white text-black px-4 py-2.5 rounded-lg text-sm font-bold hover:bg-zinc-200">Create</button>
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
                  <input type="number" className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-zinc-600 mt-1" value={editData.tradeAmount} onChange={e => setEditData({ ...editData, tradeAmount: e.target.value })} />
                </div>
                <div>
                  <label className="text-[9px] font-bold text-zinc-600 uppercase tracking-wider ml-1">Max Per Market (USDC)</label>
                  <input type="number" className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-zinc-600 mt-1" value={editData.maxPerMarket} onChange={e => setEditData({ ...editData, maxPerMarket: e.target.value })} />
                </div>
                <div className="pt-2 flex gap-2">
                  <button onClick={() => setEditSettings(false)} className="flex-1 px-4 py-2.5 rounded-lg border border-zinc-800 text-sm font-medium hover:bg-zinc-800">Cancel</button>
                  <button onClick={saveSettings} className="flex-1 bg-white text-black px-4 py-2.5 rounded-lg text-sm font-bold hover:bg-zinc-200">Save</button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
