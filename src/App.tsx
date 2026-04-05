/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
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
import axios from 'axios';
import { cn, formatCurrency, formatAddress } from './lib/utils';
import { fetchTraderTrades, getTraderStats, PolymarketTrade, TraderStats } from './services/polymarket';

interface BotInstance {
  id: string;
  name: string;
  traderAddress: string;
  status: 'active' | 'paused';
  virtualBalance: number;
  initialBalance: number;
  createdAt: string;
}

export default function App() {
  const [bots, setBots] = useState<BotInstance[]>([]);
  const [selectedBotId, setSelectedBotId] = useState<string | null>(null);
  const [traderStats, setTraderStats] = useState<TraderStats | null>(null);
  const [recentTrades, setRecentTrades] = useState<PolymarketTrade[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAddingBot, setIsAddingBot] = useState(false);
  const [newBotData, setNewBotData] = useState({ name: '', address: '', balance: '1000' });

  const selectedBot = bots.find(b => b.id === selectedBotId);

  useEffect(() => {
    fetchBots();
  }, []);

  useEffect(() => {
    if (selectedBot) {
      loadTraderData(selectedBot.traderAddress);
      
      // Simulate live trade updates every 30 seconds
      const interval = setInterval(() => {
        const newTrade: PolymarketTrade = {
          id: `live-${Date.now()}`,
          market: "Will Bitcoin hit $100k in 2024?",
          asset: "USDC",
          side: Math.random() > 0.5 ? 'BUY' : 'SELL',
          size: (Math.random() * 500).toFixed(2),
          price: (Math.random() * 0.9 + 0.05).toFixed(2),
          timestamp: new Date().toISOString(),
          transactionHash: `0x${Math.random().toString(16).slice(2)}`
        };
        setRecentTrades(prev => [newTrade, ...prev.slice(0, 9)]);
      }, 30000);

      return () => clearInterval(interval);
    }
  }, [selectedBotId]);

  const fetchBots = async () => {
    try {
      const res = await axios.get('/api/bots');
      setBots(res.data);
      if (res.data.length > 0 && !selectedBotId) {
        setSelectedBotId(res.data[0].id);
      }
    } catch (err) {
      console.error('Failed to fetch bots', err);
    } finally {
      setIsLoading(false);
    }
  };

  const loadTraderData = async (address: string) => {
    setIsLoading(true);
    try {
      const [stats, trades] = await Promise.all([
        getTraderStats(address),
        fetchTraderTrades(address)
      ]);
      setTraderStats(stats);
      setRecentTrades(trades);
    } catch (err) {
      console.error('Failed to load trader data', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddBot = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await axios.post('/api/bots', {
        name: newBotData.name,
        traderAddress: newBotData.address,
        initialBalance: newBotData.balance
      });
      setBots([...bots, res.data]);
      setIsAddingBot(false);
      setNewBotData({ name: '', address: '', balance: '1000' });
      setSelectedBotId(res.data.id);
    } catch (err) {
      console.error('Failed to add bot', err);
    }
  };

  const deleteBot = async (id: string) => {
    try {
      await axios.delete(`/api/bots/${id}`);
      const updatedBots = bots.filter(b => b.id !== id);
      setBots(updatedBots);
      if (selectedBotId === id) {
        setSelectedBotId(updatedBots.length > 0 ? updatedBots[0].id : null);
      }
    } catch (err) {
      console.error('Failed to delete bot', err);
    }
  };

  // Mock performance data for the chart
  const performanceData = [
    { time: '00:00', value: 1000 },
    { time: '04:00', value: 1050 },
    { time: '08:00', value: 1020 },
    { time: '12:00', value: 1100 },
    { time: '16:00', value: 1150 },
    { time: '20:00', value: 1130 },
    { time: '23:59', value: 1200 },
  ];

  return (
    <div className="min-h-screen flex flex-col font-sans">
      {/* Header */}
      <header className="h-16 border-b border-zinc-800 flex items-center justify-between px-6 bg-zinc-950/80 backdrop-blur-md sticky top-0 z-40">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center">
            <Bot className="text-zinc-950 w-5 h-5" />
          </div>
          <h1 className="text-lg font-semibold tracking-tight">PolySim</h1>
          <span className="px-2 py-0.5 rounded-full bg-zinc-800 text-[10px] font-medium text-zinc-400 uppercase tracking-wider">Simulation Mode</span>
        </div>
        
        <div className="flex items-center gap-4">
          <button 
            onClick={() => setIsAddingBot(true)}
            className="flex items-center gap-2 bg-white text-zinc-950 px-4 py-2 rounded-full text-sm font-medium hover:bg-zinc-200 transition-colors"
          >
            <Plus className="w-4 h-4" />
            New Bot
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className="w-72 border-r border-zinc-800 flex flex-col bg-zinc-950">
          <div className="p-4 border-b border-zinc-800">
            <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-4">Your Bots</h2>
            <div className="space-y-1">
              {bots.map(bot => (
                <button
                  key={bot.id}
                  onClick={() => setSelectedBotId(bot.id)}
                  className={cn(
                    "w-full flex items-center justify-between p-3 rounded-xl transition-all group",
                    selectedBotId === bot.id 
                      ? "bg-zinc-900 border border-zinc-800" 
                      : "hover:bg-zinc-900/50 border border-transparent"
                  )}
                >
                  <div className="flex items-center gap-3">
                    <div className={cn(
                      "w-2 h-2 rounded-full",
                      bot.status === 'active' ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]" : "bg-zinc-600"
                    )} />
                    <div className="text-left">
                      <p className="text-sm font-medium">{bot.name}</p>
                      <p className="text-[10px] text-zinc-500 font-mono">{formatAddress(bot.traderAddress)}</p>
                    </div>
                  </div>
                  <ChevronRight className={cn(
                    "w-4 h-4 text-zinc-600 transition-transform",
                    selectedBotId === bot.id ? "translate-x-0 opacity-100" : "-translate-x-2 opacity-0 group-hover:opacity-100"
                  )} />
                </button>
              ))}
              {bots.length === 0 && (
                <div className="text-center py-8">
                  <p className="text-sm text-zinc-500">No bots deployed</p>
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

        {/* Main Content */}
        <main className="flex-1 overflow-y-auto bg-zinc-950 p-8">
          {selectedBot ? (
            <div className="max-w-6xl mx-auto space-y-8">
              {/* Bot Header */}
              <div className="flex items-end justify-between">
                <div>
                  <div className="flex items-center gap-3 mb-2">
                    <h2 className="text-3xl font-bold tracking-tight">{selectedBot.name}</h2>
                    <span className="px-2 py-0.5 rounded-md bg-green-500/10 text-green-500 text-[10px] font-bold uppercase">Active</span>
                  </div>
                  <div className="flex items-center gap-4 text-zinc-400 text-sm">
                    <div className="flex items-center gap-1.5">
                      <User className="w-4 h-4" />
                      <span className="font-mono">{selectedBot.traderAddress}</span>
                      <button className="hover:text-white"><ExternalLink className="w-3 h-3" /></button>
                    </div>
                    <div className="w-1 h-1 rounded-full bg-zinc-800" />
                    <span>Created {new Date(selectedBot.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>
                
                <div className="flex gap-3">
                  <button className="p-2.5 rounded-xl border border-zinc-800 hover:bg-zinc-900 transition-colors">
                    <RefreshCw className="w-5 h-5 text-zinc-400" />
                  </button>
                  <button 
                    onClick={() => deleteBot(selectedBot.id)}
                    className="p-2.5 rounded-xl border border-zinc-800 hover:bg-red-500/10 hover:border-red-500/50 group transition-all"
                  >
                    <Trash2 className="w-5 h-5 text-zinc-400 group-hover:text-red-500" />
                  </button>
                </div>
              </div>

              {/* Stats Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="glass-card p-6 rounded-3xl">
                  <div className="flex items-center justify-between mb-4">
                    <div className="p-2 rounded-xl bg-zinc-800">
                      <Wallet className="w-5 h-5 text-zinc-400" />
                    </div>
                    <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Balance</span>
                  </div>
                  <p className="text-2xl font-bold">{formatCurrency(selectedBot.virtualBalance)}</p>
                  <div className="flex items-center gap-1 mt-1 text-zinc-500 text-xs">
                    <span>Initial: {formatCurrency(selectedBot.initialBalance)}</span>
                  </div>
                </div>

                <div className="glass-card p-6 rounded-3xl">
                  <div className="flex items-center justify-between mb-4">
                    <div className="p-2 rounded-xl bg-zinc-800">
                      <Activity className="w-5 h-5 text-zinc-400" />
                    </div>
                    <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">PnL (24h / 7d / 30d)</span>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-zinc-500">24h</span>
                      <span className={cn("text-sm font-bold", (traderStats?.pnl24h || 0) >= 0 ? "text-green-500" : "text-red-500")}>
                        {formatCurrency(traderStats?.pnl24h || 0)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-zinc-500">7d</span>
                      <span className={cn("text-sm font-bold", (traderStats?.pnl7d || 0) >= 0 ? "text-green-500" : "text-red-500")}>
                        {formatCurrency(traderStats?.pnl7d || 0)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-zinc-500">30d</span>
                      <span className={cn("text-sm font-bold", (traderStats?.pnl30d || 0) >= 0 ? "text-green-500" : "text-red-500")}>
                        {formatCurrency(traderStats?.pnl30d || 0)}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="glass-card p-6 rounded-3xl">
                  <div className="flex items-center justify-between mb-4">
                    <div className="p-2 rounded-xl bg-zinc-800">
                      <BarChart3 className="w-5 h-5 text-zinc-400" />
                    </div>
                    <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Win Rate</span>
                  </div>
                  <p className="text-2xl font-bold">{(traderStats?.winRate || 0).toFixed(1)}%</p>
                  <div className="w-full bg-zinc-800 h-1.5 rounded-full mt-3 overflow-hidden">
                    <div 
                      className="bg-white h-full rounded-full" 
                      style={{ width: `${traderStats?.winRate || 0}%` }} 
                    />
                  </div>
                </div>

                <div className="glass-card p-6 rounded-3xl">
                  <div className="flex items-center justify-between mb-4">
                    <div className="p-2 rounded-xl bg-zinc-800">
                      <RefreshCw className="w-5 h-5 text-zinc-400" />
                    </div>
                    <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Total Trades</span>
                  </div>
                  <p className="text-2xl font-bold">{traderStats?.totalTrades || 0}</p>
                  <p className="text-zinc-500 text-xs mt-1">Lifetime activity</p>
                </div>
              </div>

              {/* Performance Chart */}
              <div className="glass-card p-8 rounded-3xl">
                <div className="flex items-center justify-between mb-8">
                  <h3 className="text-lg font-semibold">Performance History</h3>
                  <div className="flex gap-2">
                    {['24H', '7D', '30D', 'ALL'].map(t => (
                      <button key={t} className={cn(
                        "px-3 py-1 rounded-lg text-[10px] font-bold transition-colors",
                        t === '24H' ? "bg-white text-zinc-950" : "text-zinc-500 hover:text-white"
                      )}>
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="h-[300px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={performanceData}>
                      <defs>
                        <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#ffffff" stopOpacity={0.1}/>
                          <stop offset="95%" stopColor="#ffffff" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                      <XAxis 
                        dataKey="time" 
                        stroke="#71717a" 
                        fontSize={10} 
                        tickLine={false} 
                        axisLine={false} 
                      />
                      <YAxis 
                        stroke="#71717a" 
                        fontSize={10} 
                        tickLine={false} 
                        axisLine={false} 
                        tickFormatter={(val) => `$${val}`}
                      />
                      <Tooltip 
                        contentStyle={{ backgroundColor: '#18181b', border: '1px solid #27272a', borderRadius: '12px' }}
                        itemStyle={{ color: '#ffffff' }}
                      />
                      <Area 
                        type="monotone" 
                        dataKey="value" 
                        stroke="#ffffff" 
                        strokeWidth={2}
                        fillOpacity={1} 
                        fill="url(#colorValue)" 
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Recent Trades Table */}
              <div className="glass-card rounded-3xl overflow-hidden">
                <div className="p-6 border-b border-zinc-800 flex items-center justify-between">
                  <h3 className="text-lg font-semibold">Recent Trader Activity</h3>
                  <button className="text-xs text-zinc-500 hover:text-white transition-colors">View all on Polymarket</button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider border-b border-zinc-800">
                        <th className="px-6 py-4">Market</th>
                        <th className="px-6 py-4">Side</th>
                        <th className="px-6 py-4">Price</th>
                        <th className="px-6 py-4">Size</th>
                        <th className="px-6 py-4">Time</th>
                        <th className="px-6 py-4 text-right">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800/50">
                      {recentTrades.map((trade) => (
                        <tr key={trade.id} className="hover:bg-zinc-900/30 transition-colors group">
                          <td className="px-6 py-4">
                            <div className="flex flex-col">
                              <span className="text-sm font-medium line-clamp-1">{trade.market}</span>
                              <span className="text-[10px] text-zinc-500 font-mono">{trade.transactionHash.slice(0, 10)}...</span>
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <span className={cn(
                              "px-2 py-1 rounded-md text-[10px] font-bold",
                              trade.side === 'BUY' ? "bg-green-500/10 text-green-500" : "bg-red-500/10 text-red-500"
                            )}>
                              {trade.side}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-sm font-mono">${trade.price}</td>
                          <td className="px-6 py-4 text-sm font-mono">{trade.size} USDC</td>
                          <td className="px-6 py-4 text-xs text-zinc-500">
                            {new Date(trade.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </td>
                          <td className="px-6 py-4 text-right">
                            <span className="text-[10px] font-bold text-zinc-600 uppercase">Simulated</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-center space-y-6">
              <div className="w-20 h-20 bg-zinc-900 rounded-3xl flex items-center justify-center border border-zinc-800">
                <Bot className="w-10 h-10 text-zinc-500" />
              </div>
              <div>
                <h2 className="text-2xl font-bold tracking-tight mb-2">No Bot Selected</h2>
                <p className="text-zinc-500 max-w-sm">Select an existing bot from the sidebar or create a new one to start simulating copy trades.</p>
              </div>
              <button 
                onClick={() => setIsAddingBot(true)}
                className="bg-white text-zinc-950 px-6 py-3 rounded-full font-semibold hover:bg-zinc-200 transition-all"
              >
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
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsAddingBot(false)}
              className="absolute inset-0 bg-zinc-950/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-[32px] p-8 shadow-2xl"
            >
              <h3 className="text-2xl font-bold tracking-tight mb-6">Deploy New Bot</h3>
              <form onSubmit={handleAddBot} className="space-y-5">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider ml-1">Bot Name</label>
                  <input 
                    type="text" 
                    required
                    placeholder="e.g. Polymarket Whale"
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-2xl px-4 py-3 text-sm focus:outline-none focus:border-white transition-colors"
                    value={newBotData.name}
                    onChange={e => setNewBotData({...newBotData, name: e.target.value})}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider ml-1">Trader Address</label>
                  <input 
                    type="text" 
                    required
                    placeholder="0x..."
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-2xl px-4 py-3 text-sm font-mono focus:outline-none focus:border-white transition-colors"
                    value={newBotData.address}
                    onChange={e => setNewBotData({...newBotData, address: e.target.value})}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider ml-1">Initial Virtual Balance (USDC)</label>
                  <input 
                    type="number" 
                    required
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-2xl px-4 py-3 text-sm focus:outline-none focus:border-white transition-colors"
                    value={newBotData.balance}
                    onChange={e => setNewBotData({...newBotData, balance: e.target.value})}
                  />
                </div>
                <div className="pt-4 flex gap-3">
                  <button 
                    type="button"
                    onClick={() => setIsAddingBot(false)}
                    className="flex-1 px-6 py-3 rounded-2xl border border-zinc-800 font-semibold hover:bg-zinc-800 transition-colors"
                  >
                    Cancel
                  </button>
                  <button 
                    type="submit"
                    className="flex-1 bg-white text-zinc-950 px-6 py-3 rounded-2xl font-bold hover:bg-zinc-200 transition-colors"
                  >
                    Deploy Bot
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
