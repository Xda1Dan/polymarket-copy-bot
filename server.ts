import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // In-memory storage for bots and simulated trades
  // In a real app, this would be a database
  let bots = [
    {
      id: "1",
      name: "Whale Alpha",
      traderAddress: "0x1234567890123456789012345678901234567890",
      status: "active",
      virtualBalance: 10000,
      initialBalance: 10000,
      createdAt: new Date().toISOString(),
    }
  ];

  // API Routes
  app.get("/api/bots", (req, res) => {
    res.json(bots);
  });

  app.post("/api/bots", (req, res) => {
    const { name, traderAddress, initialBalance } = req.body;
    const newBot = {
      id: Math.random().toString(36).substring(7),
      name,
      traderAddress,
      status: "active",
      virtualBalance: Number(initialBalance) || 1000,
      initialBalance: Number(initialBalance) || 1000,
      createdAt: new Date().toISOString(),
    };
    bots.push(newBot);
    res.status(201).json(newBot);
  });

  app.delete("/api/bots/:id", (req, res) => {
    bots = bots.filter(b => b.id !== req.params.id);
    res.status(204).send();
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
