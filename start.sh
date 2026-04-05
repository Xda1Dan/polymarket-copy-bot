#!/bin/bash
cd /home/ubuntu/.openclaw/workspace/polymarket-copy-bot
# Kill old processes
kill $(lsof -t -i:3000) 2>/dev/null
pkill -f localtunnel 2>/dev/null
sleep 2
# Start server
npx tsx server.ts &
SERVER_PID=$!
echo "Server PID: $SERVER_PID"
# Wait for server to be ready
sleep 4
# Start tunnel
npx localtunnel --port 3000 &
TUNNEL_PID=$!
echo "Tunnel PID: $TUNNEL_PID"
# Wait for tunnel URL
sleep 5
echo "=== SERVICES RUNNING ==="
echo "Server: http://localhost:3000"
echo "Server PID: $SERVER_PID"
echo "Tunnel PID: $TUNNEL_PID"
# Keep alive
wait
