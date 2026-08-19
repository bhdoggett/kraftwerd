import betterAuth from "@convex-dev/better-auth/convex.config";
import { defineApp } from "convex/server";
import { v } from "convex/values";

const app = defineApp({
  env: {
    /**
     * Origin the browser app is served from, for trusted origins and CORS.
     * Defaults to the Vite dev server when unset.
     */
    SITE_URL: v.optional(v.string()),
    /**
     * Optional so the app can be pushed and developed before a Google OAuth
     * client exists. Sign-in fails with an explicit message if they are
     * missing -- see `requireGoogleCredentials` in auth.ts.
     */
    GOOGLE_CLIENT_ID: v.optional(v.string()),
    GOOGLE_CLIENT_SECRET: v.optional(v.string()),
    /**
     * Set to "1" on a development deployment to expose the helpers in dev.ts.
     * Absent everywhere else, so production cannot be seeded or fast-forwarded.
     */
    DEV_TOOLS: v.optional(v.string()),
  },
});

app.use(betterAuth);

export default app;
