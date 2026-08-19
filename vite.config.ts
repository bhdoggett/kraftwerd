import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig, loadEnv } from "vite";

/**
 * Vite inlines VITE_* at BUILD time. If the host supplies them only as
 * runtime variables the bundle ships with empty strings and the app dies in
 * the browser with "No address provided to ConvexReactClient" -- a failure
 * that looks like a code bug and is nowhere near the actual mistake. Fail the
 * build instead.
 */
function requireConvexEnv(mode: string) {
  const env = loadEnv(mode, process.cwd(), "");
  const missing = ["VITE_CONVEX_URL", "VITE_CONVEX_SITE_URL"].filter(
    (key) => !env[key],
  );

  if (missing.length > 0) {
    throw new Error(
      `Missing build-time environment variables: ${missing.join(", ")}.\n` +
        "On Coolify these must be marked as BUILD variables, not runtime ones.\n" +
        "See docs/deploy.md.",
    );
  }
}

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  if (command === "build") requireConvexEnv(mode);

  return {
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
  };
});
