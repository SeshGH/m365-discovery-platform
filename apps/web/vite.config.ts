import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      // Proxy API calls to Fastify to avoid CORS changes.
      // We proxy the known API prefixes you described.
      "/runs": "http://localhost:8080",
      "/artefacts": "http://localhost:8080",
      "/tenants": "http://localhost:8080"
    }
  }
});
