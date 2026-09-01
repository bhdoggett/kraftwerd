import { createClient, type AuthFunctions, type GenericCtx } from "@convex-dev/better-auth";
import { convex, crossDomain } from "@convex-dev/better-auth/plugins";
import { betterAuth } from "better-auth/minimal";
import { anonymous } from "better-auth/plugins/anonymous";
import { components, internal } from "./_generated/api";
import { env } from "./_generated/server";
import type { DataModel } from "./_generated/dataModel";
import authConfig from "./auth.config";
import { claimInvites } from "./friends";

// Declared in convex.config.ts, so these are typed rather than read as bare
// strings off process.env. They are optional so the app still pushes before a
// Google OAuth client exists; sign-in is what fails, not the deploy.
/**
 * Origins allowed to complete an OAuth callback. Comma-separated, so one
 * deployment can serve both local development and a deployed frontend; the
 * first entry is the canonical site URL. The default matches the port
 * vite.config.ts pins.
 */
const siteUrls = (env.SITE_URL ?? "http://localhost:5175")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const siteUrl = siteUrls[0]!;

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
        // Better Auth's own field, from the anonymous plugin below.
        const guest = (doc as { isAnonymous?: boolean | null }).isAnonymous === true;

        const userId = await ctx.db.insert("users", {
          authId: doc._id,
          email: doc.email,
          name: doc.name ?? undefined,
          image: doc.image ?? undefined,
          ...(guest ? { isGuest: true } : {}),
        });
        // Anyone who asked to be their friend before they had an account.
        await claimInvites(ctx, userId, doc.email);
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
    trustedOrigins: siteUrls,
    database: authComponent.adapter(ctx),
    // Google only. No password flow means no password storage, no reset
    // emails, and nothing to phish.
    socialProviders,
    plugins: [
      /*
       * A guest account, so the game can be played before it is joined.
       *
       * Signing in with Google is a lot to ask of somebody who has not seen
       * the game yet, and the board on the sign-in page can only show them so
       * much. A guest gets a real account with a made-up address: real enough
       * to hold a game, and gone when the browser forgets the session.
       *
       * A guest who goes on to make a real account starts fresh there; the
       * game they tried is left behind with the guest, which is what a trial
       * game is for. The guest row is kept rather than deleted, though --
       * Better Auth would remove it, and the game it played would be left
       * pointing at somebody who no longer exists.
       */
      anonymous({
        generateName: () => "Guest",
        disableDeleteAnonymousUser: true,
      }),
      crossDomain({ siteUrl }),
      convex({ authConfig }),
    ],
  });
