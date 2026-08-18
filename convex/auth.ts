import { createClient, type AuthFunctions, type GenericCtx } from "@convex-dev/better-auth";
import { convex, crossDomain } from "@convex-dev/better-auth/plugins";
import { betterAuth } from "better-auth/minimal";
import { components, internal } from "./_generated/api";
import { env } from "./_generated/server";
import type { DataModel } from "./_generated/dataModel";
import authConfig from "./auth.config";

// Declared in convex.config.ts, so these are typed rather than read as bare
// strings off process.env. They are optional so the app still pushes before a
// Google OAuth client exists; sign-in is what fails, not the deploy.
const siteUrl = env.SITE_URL ?? "http://localhost:5173";

/**
 * Whether a Google OAuth client has been configured.
 *
 * `registerRoutes` builds the auth instance eagerly at module load, so a
 * missing credential cannot throw here -- that would take down every HTTP
 * route, not just sign-in. The provider is omitted instead, and the sign-in
 * screen asks `api.users.authStatus` so it can say what is wrong.
 */
export const googleConfigured = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);

const socialProviders = googleConfigured
  ? {
      google: {
        clientId: env.GOOGLE_CLIENT_ID as string,
        clientSecret: env.GOOGLE_CLIENT_SECRET as string,
      },
    }
  : {};

const authFunctions: AuthFunctions = internal.auth;

export const authComponent = createClient<DataModel>(components.betterAuth, {
  authFunctions,
  triggers: {
    // Mirror Better Auth's user into an app-level row, in the same
    // transaction, so game documents can hold a real Id<"users">.
    user: {
      onCreate: async (ctx, doc) => {
        await ctx.db.insert("users", {
          authId: doc._id,
          email: doc.email,
          name: doc.name ?? undefined,
          image: doc.image ?? undefined,
        });
      },
      onUpdate: async (ctx, newDoc) => {
        const user = await ctx.db
          .query("users")
          .withIndex("by_authId", (q) => q.eq("authId", newDoc._id))
          .unique();
        if (user === null) return;
        await ctx.db.patch("users", user._id, {
          email: newDoc.email,
          name: newDoc.name ?? undefined,
          image: newDoc.image ?? undefined,
        });
      },
    },
  },
});

export const { onCreate, onUpdate, onDelete } = authComponent.triggersApi();

export const createAuth = (ctx: GenericCtx<DataModel>) =>
  betterAuth({
    baseURL: env.CONVEX_SITE_URL,
    trustedOrigins: [siteUrl],
    database: authComponent.adapter(ctx),
    // Google only. No password flow means no password storage, no reset
    // emails, and nothing to phish.
    socialProviders,
    plugins: [crossDomain({ siteUrl }), convex({ authConfig })],
  });
