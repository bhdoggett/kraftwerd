import { convexClient, crossDomainClient } from "@convex-dev/better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { anonymousClient } from "better-auth/client/plugins";

/**
 * Left inferred so app code gets real types for `signIn.social` etc. The cast
 * to the provider's `AuthClient` happens at the single call site in main.tsx;
 * see the note there.
 */
export const authClient = createAuthClient({
  baseURL: import.meta.env.VITE_CONVEX_SITE_URL as string,
  plugins: [convexClient(), crossDomainClient(), anonymousClient()],
});
