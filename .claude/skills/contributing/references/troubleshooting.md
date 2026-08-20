# When something breaks

Check here before guessing. Most failures in this project do not look like
failures.

## Every word is rejected, even real ones

The dictionary is empty. This is the most common problem and it produces no
error.

```bash
npm run build:dictionary
npx convex import -y --table words --replace shared/data/words.jsonl
```

## Sign-in fails with redirect_uri_mismatch

Ben has not yet added his backend's callback address to the Google settings.
Send him the `CONVEX_DEPLOYMENT` value from `.env.local` and this line:

```
https://<that-deployment>.convex.site/api/auth/callback/google
```

Nothing he can do locally fixes this.

## The sign-in button is greyed out

`GOOGLE_CLIENT_ID` or `GOOGLE_CLIENT_SECRET` is missing from his backend. Check
with `npx convex env list`. The app is designed to degrade this way rather than
crash.

## The build fails mentioning styleText

Wrong Node version. Run `nvm use` — this project needs Node 24. If `nvm` is not
installed, he needs to install Node 24 directly.

## A push is rejected

`origin/main` moved on. Bring it in and push again:

```bash
git fetch origin
git merge origin/main
git push
```

## A command was denied by a hook

Working as intended. The denial says what to do instead — do that. Do not look
for a way around it, and do not change the hook.

## The app opens on the wrong port, or sign-in breaks after restarting

The port is pinned to 5175 deliberately. If something else is already using it,
the dev server fails loudly instead of quietly moving — that is intentional,
because the sign-in flow is tied to the address. Close whatever is on 5175 and
start again.
