import { defineConfig } from "vite";

import { resolveApiPort } from "./src/server/config.js";

const apiPort = resolveApiPort(process.env.PORT);
const apiOrigin = `http://127.0.0.1:${apiPort}`;

export default defineConfig({
  server: {
    host: "127.0.0.1",
    proxy: {
      "/api": {
        target: apiOrigin,
        // Preserve the original Host/Origin so Fastify applies its own allowlist.
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: "dist/client",
    emptyOutDir: false,
  },
});
