import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Pinned to match SITE_URL on the Convex deployment, which Better Auth uses
  // as a trusted origin. strictPort makes a clash fail loudly instead of
  // silently hopping to another port and breaking the OAuth callback.
  server: {
    port: 5175,
    strictPort: true,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
