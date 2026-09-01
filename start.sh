#!/bin/bash
echo "Starting Personal Finance Tracker & AI Coach..."

# Get root folder path
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"

# Start FastAPI Backend on Port 8002
echo "Starting FastAPI Backend on http://127.0.0.1:8002..."
cd "$DIR/backend"
"./.venv/bin/uvicorn" main:app --host 127.0.0.1 --port 8002 --reload &
BACKEND_PID=$!

# Start Next.js Frontend on Port 3000
echo "Starting Next.js Frontend on http://localhost:3000..."
cd "$DIR/frontend"
npm run dev &
FRONTEND_PID=$!

echo "=================================================="
echo "🚀 Application Live!"
echo "👉 Open http://localhost:3000 in your browser"
echo "=================================================="

trap "kill $BACKEND_PID $FRONTEND_PID" EXIT
wait
