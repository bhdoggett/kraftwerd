# Deploying

Two halves deploy separately: Convex runs the backend, and the frontend is a
static bundle served from Coolify.

## Frontend (Coolify, Nixpacks)

| setting | value |
|---------|-------|
| Build Pack | Nixpacks |
| Base Directory | `/` |
| Install Command | `npm ci` |
| Build Command | `npm run build` |
| Start Command | `npm start` |
| Port | `3000` |

Base Directory is `/` because this is not a monorepo — `package.json`,
`index.html`, and `vite.config.ts` are all at the repo root.

Coolify's **Static** build pack does not fit: it serves files already
committed to the repo and runs no build, and `dist/` is gitignored.

`npm start` is `serve -s dist --no-port-switching -l ${PORT:-3000}`:

- `-s` is the SPA fallback. Without it `/game/<id>` 404s on refresh and every
  shared invite link breaks.
- `--no-port-switching` makes a port clash fail loudly. By default `serve`
  quietly binds some other random port, and the platform then health-checks a
  port nothing is listening on.

### Build-time environment variables

These must be set as **build** variables, not runtime ones. Vite inlines
`VITE_*` at build time; as runtime env vars they are empty strings and the app
loads with no backend URL.

```
VITE_CONVEX_URL=https://<prod-deployment>.convex.cloud
VITE_CONVEX_SITE_URL=https://<prod-deployment>.convex.site
```

Take both from the **production** Convex deployment, not the dev one.

## Backend (Convex production)

Production is a different deployment from dev, with its own URL and its own
empty set of environment variables. Nothing carries over.

```bash
npx convex deploy                       # creates/pushes prod
npx convex env set --prod BETTER_AUTH_SECRET "$(openssl rand -base64 32)"
npx convex env set --prod SITE_URL https://<your-coolify-domain>
npx convex env set --prod GOOGLE_CLIENT_ID <id>
npx convex env set --prod GOOGLE_CLIENT_SECRET <secret>
```

`SITE_URL` must be the deployed frontend origin. If it still says
`localhost:5175`, the OAuth callback is rejected as an untrusted origin.

Then seed the dictionary into prod — the `words` table starts empty, and an
empty dictionary rejects every play:

```bash
npm run build:dictionary
npx convex import --prod --table words --replace shared/data/words.jsonl
```

## Google OAuth for production

Add a **second** redirect URI to the same Google OAuth client, pointing at the
production deployment's own site host:

```
https://<prod-deployment>.convex.site/api/auth/callback/google
```

Each Convex deployment has its own `.convex.site` hostname, so the dev URI
does not cover prod. Authorised JavaScript origins stays empty — see
[auth-setup.md](./auth-setup.md).

## Checklist

- [ ] `npx convex deploy` run against prod
- [ ] Prod env vars set (secret, `SITE_URL`, both Google values)
- [ ] Dictionary imported into prod
- [ ] Prod redirect URI added in Google Cloud
- [ ] Coolify build variables point at the **prod** Convex URLs
- [ ] Visit `/game/<anything>` directly — it should load the app, not a 404
