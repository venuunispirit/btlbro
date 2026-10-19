import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Which API the dev server proxies to.
//
// BTLbro's own server listens on 8082 (see server/index.js and the `dev:api`
// script). 8081 is deliberately NOT the default: it is commonly taken by another
// local project, and proxying there fails in a very confusing way — every
// request 404s as {"message":"API route not found"} and the admin dashboard
// just looks empty, with no hint that it is talking to the wrong server.
// The old 8081 default caused exactly that, so the port is now declared here
// once and loudly logged at startup instead.
const API_PORT = process.env.API_PORT || 8082;
const apiTarget = `http://localhost:${API_PORT}`;

// Extra Host headers the dev/preview servers accept.
//
// Vite rejects requests whose Host header it doesn't recognise (DNS-rebinding
// protection). `localhost` and bare IPs are always allowed regardless of this
// list, so it only governs additional names — in practice a Cloudflare tunnel.
//
// Quick tunnels hand out a NEW random hostname every time cloudflared
// restarts, so allow the suffix instead of pinning the one hostname, which
// would break again on the next tunnel restart. Override or extend with
// VITE_EXTRA_HOSTS="named.example.com,other.test" for a named tunnel.
const allowedHosts = [
  ".trycloudflare.com",
  ...(process.env.VITE_EXTRA_HOSTS || "")
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean),
];

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    open: true,
    allowedHosts,
    proxy: {
      "/api": {
        target: apiTarget,
        changeOrigin: true,
      },
      "/uploads": {
        target: apiTarget,
        changeOrigin: true,
      },
      "/socket.io": {
        target: apiTarget,
        changeOrigin: true,
        ws: true,
      },
    },
  },
  // `vite preview` runs its own host check, so it needs the same list.
  preview: {
    allowedHosts,
  },
});

console.log(`\n  BTLbro dev server proxying /api -> ${apiTarget}`);
console.log('           Start the API with: cd server && PORT=8082 npm run dev\n');

