# Auth setup — Better Auth + Google

Google is the only sign-in method. There is no password flow, so there is no
password storage, no reset email to build, and nothing to phish.

Sign-in is wired up in code but **will not work until the two manual steps
below are done** — they need a Google account and cannot be scripted.

## 1. Create the Google OAuth client

In the [Google Cloud Console](https://console.cloud.google.com/apis/credentials):

1. Create (or pick) a project, then **Create credentials → OAuth client ID**.
2. Application type: **Web application**.
3. Under **Authorised redirect URIs**, add exactly:

   ```
   https://beaming-malamute-180.convex.site/api/auth/callback/google
   ```

   Better Auth builds the callback from `baseURL`, which is the Convex *site*
   URL (`.convex.site`), not the `.convex.cloud` one and not the Vite dev
   server. Getting this wrong produces `redirect_uri_mismatch`.

4. Leave **Authorised JavaScript origins** empty. That field is only for
   browser-side OAuth (Google Identity Services, the implicit flow, one-tap),
   where your page's JS talks to Google directly. Better Auth uses the
   server-side authorization-code flow: `signIn.social()` calls a Convex
   endpoint, which returns a URL the browser navigates to at top level. No
   request goes from your origin to Google, so there is no origin to
   authorise.

5. Copy the client ID and client secret.

If you later deploy to production, add that deployment's `.convex.site`
callback URL too — each Convex deployment has its own.

## 1b. Let other people sign in

A new OAuth client's consent screen starts in **Testing**, where only accounts
you have named can sign in. Everyone else is turned away by Google before they
ever reach the app — the error mentions the app being blocked or unverified,
which reads like something is broken rather than like a setting.

Two ways forward, in the Cloud Console under **APIs & Services → OAuth consent
screen** (newer consoles call it **Branding** / **Audience**):

- **Add them as test users.** Their Google address, one per line, up to 100.
  Fastest, and right while it is only family playing. They must sign in with
  exactly that address — a different Gmail on the same phone will not do.
- **Publish the app.** Anyone with a Google account can then sign in. Google
  only requires verification for sensitive scopes; this app asks for the basic
  profile and email, so publishing needs no review.

Nothing about this is sent to the player. The client ID and secret stay with
you — they are set with `npx convex env set` and never committed. What a new
player needs is the invite link, and nothing else.

## 1c. Someone else running their own copy

Playing needs none of this: the deployed site already has its credentials, and
a new player needs a link and a place on the test-user list.

Running the code is different. Every Convex deployment has its own
`.convex.site` URL, and a Google client only permits the redirect URIs listed
on it — so a contributor's backend cannot sign anyone in until its callback
address is allowed somewhere.

This project's answer is in `onboarding-a-contributor.md`: the owner adds the
contributor's callback URL to the existing client and sends over the same
client ID and secret, which the contributor sets on their own backend with
`npx convex env set`. One client, one consent screen, one test-user list.

The alternative is a client each, which shares no secret but means every
contributor keeps their own Google Cloud project and their own test users.
Worth it for strangers; not for the two or three people this game has.

## 2. Set the deployment environment variables

The app deploys and runs fine without these — `GOOGLE_CLIENT_ID` and
`GOOGLE_CLIENT_SECRET` are optional in `convex.config.ts`, so a push succeeds
before any Google client exists. What you get until they are set is a
disabled sign-in button explaining the situation, via `api.users.authStatus`.

They cannot be *required*: `registerRoutes` builds the auth instance eagerly at
module load, so throwing on a missing credential takes down every HTTP route
rather than just sign-in.


```bash
npx convex env set BETTER_AUTH_SECRET "$(openssl rand -base64 32)"
npx convex env set SITE_URL http://localhost:5173
npx convex env set GOOGLE_CLIENT_ID <your client id>
npx convex env set GOOGLE_CLIENT_SECRET <your client secret>
```

`SITE_URL` is the origin the browser app is served from. It is used for
trusted origins and CORS, so it must match where you actually load the app —
change it for a deployed frontend.

`SITE_URL`, `GOOGLE_CLIENT_ID`, and `GOOGLE_CLIENT_SECRET` are declared in
`convex/convex.config.ts`, so they are typed on `env` from
`./_generated/server` and validated at deploy time. Missing ones fail loudly
rather than surfacing as `undefined` at runtime.

`.env.local` already carries `CONVEX_DEPLOYMENT`, `VITE_CONVEX_URL`, and
`VITE_CONVEX_SITE_URL`; nothing needs adding there.

## How identity flows

```
Google  ->  Better Auth component  ->  users table  ->  games/players/tiles
                     |                      ^
                     |   onCreate trigger   |
                     +----------------------+
```

- The Better Auth component owns its own tables (`user`, `session`, …).
- A trigger in `convex/auth.ts` mirrors each Better Auth user into the app's
  own `users` table in the **same transaction**, so game rows reference a real
  `Id<"users">` and the game schema does not depend on the auth provider.
- `requireUser` in `convex/games.ts` resolves the caller with a single indexed
  read: Better Auth puts its user id in the JWT `subject`, so
  `users.by_authId` finds the row without a round-trip into the component.
  Convex has already verified the token's signature and expiry. The
  component's own `getAuthUser` additionally checks the session row, which
  buys revoke-before-expiry precision this game does not need.

## Testing

`convex/games.test.ts` inserts `users` rows directly with a synthetic
`authId` and calls `t.withIdentity({ subject: authId })`. The game tests
therefore exercise the real authorization path without standing up the auth
component at all. If a test ever needs the component itself, the package ships
a helper:

```ts
import betterAuthTest from "@convex-dev/better-auth/test";
betterAuthTest.register(t); // registers as "betterAuth"
```

## Known upstream issue

`src/main.tsx` casts `authClient` to the provider's `AuthClient` type. This is
a typing bug in `@convex-dev/better-auth@0.12.5`: its exported `AuthClient`
constrains `createAuthClient`'s options generic to
`BetterAuthClientPlugin & { plugins }`, which real options
(`{ baseURL, plugins }`) cannot structurally satisfy, and one member of the
union types `useSession().data` as `never`. The runtime shape is correct. Drop
the cast when the package fixes it.

Note also that `better-auth` is pinned to `~1.6.15`: the component's peer range
is `>=1.6.11 <1.7.0`, so npm's current `1.7.x` is **not** compatible.
