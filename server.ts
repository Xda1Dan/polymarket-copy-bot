import express from "express";
import WebSocket from "ws";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT) || 3000;
const POLY_DATA = "https://data-api.polymarket.com";
const POLY_WS = "wss://ws-subscriptions-clob.polymarket.com/ws/market";

// ─── Types ──────────────────────────────────────────────────────

interface BotBot {
  name: string;
  traderAddress: string;
  initialBalance: number;
  tradeAmount: number;
  maxPerMarket: number;
  tokenIds: string[]; // asset IDs to subscribe to
  wsConnected: boolean;
  startedAt: string;
  lastUpdateAt: number;
  error: string | null;
}

interface BotState {
  balance: number;
  pnl: number;
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  exposure: Record<string, number>;
}

interface SimTrade {
  id: string;
  title: string;
  side: string;
  amount: number;
  roi: number;
  profit: number;
  balanceAfter: number;
  timestamp: number;
}

interface OpenPosition {
  conditionId: string;
  title: string;
  side: string;
  size: number;
  avgPrice: number;
  currentPrice: number;
  cashPnl: number;
  percentPnl: number;
  currentValue: number;
  redeemable: boolean;
}

// ─── State ──────────────────────────────────────────────────────

const bots: Record<string, { bot: BotBot; state: BotState; trades: SimTrade[] }> = {};
const wsClients: Set<WebSocket> = new Set(); // dashboard consumers
let polyWs: WebSocket | null = null;
const subscribedAssets = new Set<string>();

// ─── Helpers ────────────────────────────────────────────────────

async function polyGet(url: string): Promise<any> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Poly ${res.status} ${url}`);
  return res.json();
}

async function fetchPaginated(endpoint: string, user: string): Promise<any[]> {
  let all: any[] = [];
  let offset = 0;
  for (let page = 0; page < 40; page++) {
    const url = `${POLY_DATA}/${endpoint}?user=${user}&limit=50&offset=${offset}&sortBy=TIMESTAMP&sortDirection=DESC`;
    const data = await polyGet(url);
    const items = Array.isArray(data) ? data : [];
    if (!items.length) break;
    all = all.concat(items);
    if (items.length < 50) break;
    offset += 50;
  }
  return all;
}

async function getTokenIds(user: string): Promise<string[]> {
  try {
    const raw = await polyGet(`${POLY_DATA}/trades?user=${user}&limit=50&sortBy=TIMESTAMP&side=BUY`);
    const assets = new Set<string>();
    if (Array.isArray(raw)) {
      for (const t of raw) {
        if (t.asset) assets.add(String(t.asset));
        if (t.token_id) assets.add(String(t.token_id));
      }
    }
    return Array.from(assets);
  } catch {
    console.error("Failed to fetch token IDs for", user);
    return [];
  }
}

async function runSimulation(
  user: string,
  initialBalance: number,
  tradeAmount: number,
  maxPerMarket: number,
): Promise<{ balance: number; trades: SimTrade[]; state: BotState }> {
  const positions = await fetchPaginated("closed-positions", user);
  positions.reverse(); // oldest first

  let balance = initialBalance;
  const exposure: Record<string, number> = {};
  const trades: SimTrade[] = [];
  let wins = 0, losses = 0, totalPnl = 0;

  for (const p of positions) {
    const key = p.conditionId || `x${trades.length}`;
    const roi = p.totalBought > 0 ? (p.realizedPnl / p.totalBought) * 100 : 0;
    const exp = exposure[key] || 0;
    if (exp >= maxPerMarket || balance < tradeAmount) continue;

    exposure[key] = exp + tradeAmount;
    const profit = tradeAmount * (roi / 100);
    balance += profit;
    totalPnl += profit;
    exposure[key] = Math.max(0, exposure[key] - tradeAmount);

    if (profit > 0.001) wins++;
    else if (profit < -0.001) losses++;

    trades.push({
      id: `sim${trades.length}`,
      title: p.title || "?",
      side: p.outcomeIndex === 0 ? "YES" : "NO",
      amount: tradeAmount,
      roi: +roi.toFixed(1),
      profit: +profit.toFixed(2),
      balanceAfter: +balance.toFixed(2),
      timestamp: p.timestamp || 0,
    });
  }

  const totalTrades = wins + losses;
  return {
    balance: +balance.toFixed(2),
    trades,
    state: {
      balance: +balance.toFixed(2),
      pnl: +totalPnl.toFixed(2),
      totalTrades,
      wins,
      losses,
      winRate: totalTrades > 0 ? +((wins / totalTrades) * 100).toFixed(1) : 0,
      exposure,
    },
  };
}

// ─── WebSocket to Polymarket ────────────────────────────────────

function connectPolyWs() {
  if (polyWs && polyWs.readyState === WebSocket.OPEN) return;
  if (polyWs && polyWs.readyState === WebSocket.CONNECTING) return;

  const assets = [...subscribedAssets];
  if (assets.length === 0) return;

  console.log(`🔌 Connecting to Polymarket WS (${assets.length} assets)`);
  polyWs = new WebSocket(POLY_WS);

  polyWs.on("open", () => {
    console.log("✅ Polymarket WebSocket connected");
    const msg = JSON.stringify({ type: "market", assets_ids: assets, operation: "subscribe" });
    polyWs!.send(msg);
    broadcast({ type: "ws_status", connected: true, assets: assets.length });
  });

  polyWs.on("message", (data: WebSocket.Data) => {
    try {
      const raw = data.toString();
      if (!raw || raw === "PING" || raw === "PONG") return;
      const msg = JSON.parse(raw);
      if (msg.event === "ping") { polyWs?.send(JSON.stringify({ event: "pong" })); return; }
      if (msg.event_type === "last_trade_price") handleWsTrade(msg);
    } catch { /* ignore parse errors */ }
  });

  polyWs.on("close", () => {
    console.log("❌ Polymarket WS disconnected, reconnecting in 3s...");
    broadcast({ type: "ws_status", connected: false });
    setTimeout(() => { connectPolyWs(); }, 3000);
  });

  polyWs.on("error", (err: Error) => {
    console.error("WS error:", err.message);
  });

  // Ping keepalive
  setInterval(() => {
    if (polyWs?.readyState === WebSocket.OPEN) {
      try { polyWs.send("PING"); } catch {}
    }
  }, 15000);
}

async function handleWsTrade(msg: any) {
  const maker = msg.maker?.toLowerCase();
  const taker = msg.taker?.toLowerCase();
  const ts = (msg.timestamp || Date.now()) < 1e12 ? (msg.timestamp || Date.now()) * 1000 : (msg.timestamp || Date.now());

  for (const [_id, entry] of Object.entries(bots)) {
    const bot = entry.bot;
    const addr = bot.traderAddress.toLowerCase();
    if (maker !== addr && taker !== addr) continue;

    const title = msg.market || "Unknown";
    const side = msg.side || "BUY";
    const price = parseFloat(msg.price) || 0;
    const size = parseFloat(msg.size) || 0;
    const conditionId = msg.condition_id || msg.asset_id || "unknown";

    console.log(`🎯 ${bot.name}: ${side} ${size} @ ${price}`);

    bot.lastUpdateAt = ts;
  }
}

function broadcast(data: any) {
  const msg = JSON.stringify(data);
  for (const client of wsClients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  }
}

// ─── Express Server ─────────────────────────────────────────────

async function startServer() {
  const app = express();
  app.use(express.json());

  // ── Health ──
  app.get("/health", (_req, res) => res.json({ ok: true, time: Date.now(), bots: Object.keys(bots).length }));

  // ── Bot CRUD ──
  app.post("/api/bots", async (req, res) => {
    try {
      const { name, traderAddress, initialBalance, tradeAmount, maxPerMarket } = req.body;
      if (!traderAddress) return res.status(400).json({ error: "traderAddress required" });
      if (!name) return res.status(400).json({ error: "name required" });

      const id = Math.random().toString(36).substring(2, 10);
      const tokenIds = await getTokenIds(traderAddress);
      tokenIds.forEach((tid) => subscribedAssets.add(tid));

      // Run historical simulation
      const sim = await runSimulation(traderAddress, initialBalance || 10, tradeAmount || 1, maxPerMarket || 9);

      bots[id] = {
        bot: {
          name,
          traderAddress,
          initialBalance: initialBalance || 10,
          tradeAmount: tradeAmount || 1,
          maxPerMarket: maxPerMarket || 9,
          tokenIds,
          wsConnected: false,
          startedAt: new Date().toISOString(),
          lastUpdateAt: Date.now(),
          error: null,
        },
        state: sim.state,
        trades: sim.trades,
      };

      console.log(`🤖 Bot added: ${name} tracking ${traderAddress} (${tokenIds.length} assets)`);
      connectPolyWs();
      res.status(201).json({ id, ...bots[id] });
    } catch (e: any) {
      console.error("Error creating bot:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/bots", (_req, res) => {
    const result = Object.entries(bots).map(([id, e]) => ({ id, ...e }));
    res.json(result);
  });

  app.get("/api/bots/:id", (req, res) => {
    const entry = bots[req.params.id];
    if (!entry) return res.status(404).json({ error: "Not found" });
    res.json({ id: req.params.id, ...entry });
  });

  app.delete("/api/bots/:id", (req, res) => {
    if (!bots[req.params.id]) return res.status(404).json({ error: "Not found" });
    delete bots[req.params.id];
    res.status(204).send();
  });

  // ── Bot Data ──
  app.get("/api/bots/:id/trades", (req, res) => {
    const entry = bots[req.params.id];
    if (!entry) return res.status(404).json({ error: "Not found" });
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    res.json({ trades: entry.trades.slice(-limit).reverse(), total: entry.trades.length });
  });

  app.get("/api/bots/:id/positions", async (req, res) => {
    const entry = bots[req.params.id];
    if (!entry) return res.status(404).json({ error: "Not found" });
    try {
      const raw = await fetchPaginated("positions", entry.bot.traderAddress);
      const closedIds = new Set(entry.trades.map((t) => t.id.split("-")[0]));
      const positions: OpenPosition[] = raw
        .filter((p: any) => p.size && p.size > 0)
        .map((p: any) => ({
          conditionId: p.conditionId || "",
          title: p.title || "Unknown",
          side: (p.outcomeIndex ?? 0) === 0 ? "YES" : "NO",
          size: p.size || 0,
          avgPrice: p.avgPrice || 0,
          currentPrice: p.curPrice || 0,
          cashPnl: +(p.cashPnl || 0),
          percentPnl: +(p.percentPnl || 0),
          currentValue: +(p.currentValue || 0),
          redeemable: !!p.redeemable,
        }));
      res.json({ positions, count: positions.length });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/bots/:id/refresh", async (req, res) => {
    const entry = bots[req.params.id];
    if (!entry) return res.status(404).json({ error: "Not found" });
    try {
      const sim = await runSimulation(
        entry.bot.traderAddress,
        entry.bot.initialBalance,
        entry.bot.tradeAmount,
        entry.bot.maxPerMarket,
      );
      entry.state = sim.state;
      entry.trades = sim.trades;
      entry.bot.lastUpdateAt = Date.now();
      res.json({ success: true, state: entry.state, tradeCount: entry.trades.length });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Trader lookup (proxy for dashboard) ──
  app.get("/api/lookup/:address/stats", async (req, res) => {
    try {
      const positions = await fetchPaginated("closed-positions", req.params.address);
      const now = Math.floor(Date.now() / 1000);
      let pnl24 = 0, pnl7 = 0, pnl30 = 0, pnlAll = 0, wins = 0, losses = 0, biggestWin = 0, biggestLoss = 0;
      for (const p of positions) {
        const pnl = p.realizedPnl || 0;
        const ts = p.timestamp || 0;
        pnlAll += pnl;
        if (now - ts <= 86400) pnl24 += pnl;
        if (now - ts <= 604800) pnl7 += pnl;
        if (now - ts <= 2592000) pnl30 += pnl;
        if (pnl > 0.01) { wins++; biggestWin = Math.max(biggestWin, pnl); }
        else if (pnl < -0.01) { losses++; biggestLoss = Math.min(biggestLoss, pnl); }
      }
      const total = wins + losses;
      res.json({ pnl24, pnl7, pnl30, pnlAll, wins, losses, totalTrades: total, winRate: total > 0 ? +((wins / total) * 100).toFixed(1) : 0, biggestWin, biggestLoss });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Frontend serving ──
  const distPath = path.join(__dirname, "dist");
  app.use(express.static(distPath));
  app.get("*", (_req, res) => res.sendFile(path.join(distPath, "index.html")));

  // ── Start ──
  const server = http.createServer(app);
  server.listen(PORT, "0.0.0.0", () => console.log(`🚀 Server running on port ${PORT}`));
}

startServer().catch(console.error);
