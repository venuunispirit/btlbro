#!/bin/bash
echo "Starting BTLbro server..."
cd "$(dirname "$0")/server" && node index.js &
echo "Server starting on http://localhost:3001"
echo ""
echo "In another terminal, run:  npm run dev"
echo "Then open:                http://localhost:5173/admin"
echo ""
echo "Login: admin@btlbro.in / 1234"
wait
