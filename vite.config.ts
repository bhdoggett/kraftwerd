import react from "@vitejs/plugin-react";
import { readFileSync, writeFileSync } from "fs";
import path from "path";
import { defineConfig, loadEnv, type Plugin } from "vite";

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

/**
 * Link-preview crawlers read og:title from the served HTML and run no
 * JavaScript, so a friend invite and a game invite can only show different
 * text if they are served different files. This writes a copy of the built
 * index.html per link type with its own title; serve.json routes /friend/*
 * and /game/* to them.
 *
 * og:url is dropped from the copies: Facebook refetches og:url and would show
 * the home page's card instead.
 */
const SHARE_CARDS = {
  "friend.html": "Be my friend on Kraftwerd",
  "game.html": "Join my game in Kraftwerd",
};

function shareCards(): Plugin {
  return {
    name: "share-cards",
    apply: "build",
    writeBundle({ dir = "dist" }) {
      const index = readFileSync(path.join(dir, "index.html"), "utf8");
      const ogTitle = /<meta property="og:title" content="[^"]*" \/>/;
      const ogUrl = /\s*<meta property="og:url" content="[^"]*" \/>/;
      if (!ogTitle.test(index) || !ogUrl.test(index)) {
        throw new Error(
          "share-cards: og:title or og:url missing from index.html",
        );
      }

      for (const [file, title] of Object.entries(SHARE_CARDS)) {
        const html = index
          .replace(ogTitle, `<meta property="og:title" content="${title}" />`)
          .replace(ogUrl, "");
        writeFileSync(path.join(dir, file), html);
      }
    },
  };
}

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  if (command === "build") requireConvexEnv(mode);

  return {
    plugins: [react(), shareCards()],
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
