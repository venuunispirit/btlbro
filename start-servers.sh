#!/bin/bash
# Kill anything on our ports first
kill $(lsof -t -i:5173) 2>/dev/null
kill $(lsof -t -i:8081) 2>/dev/null
sleep 1

cd /Users/hackercode/Downloads/btl

# Start backend
cd server && node index.js &
echo "Backend PID: $!"
sleep 2

# Start frontend
cd /Users/hackercode/Downloads/btl && npx vite --host &
echo "Frontend PID: $!"
sleep 2

echo "Both servers started. Vite on :5173, Express on :8081"
# Keep this script alive so child processes survive
wait
