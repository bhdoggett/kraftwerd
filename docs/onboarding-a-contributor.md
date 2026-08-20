# Onboarding a contributor

Everything here is done by the repo owner, once per person. The contributor's
own steps are handled by the `contributing` skill on his machine — he does not
read this file.

## Before he starts

1. **GitHub access** — add him as a collaborator:
   `gh api repos/bhdoggett/kraftwerd/collaborators/<his-github-username> -X PUT -f permission=push`
   Push access lets him create branches. `main` stays protected by the
   `protect-main` ruleset regardless.

2. **Convex team** — dashboard.convex.dev → Team Settings → Members → invite by
   email, role **Developer** (not Admin — Developer cannot touch billing or
   membership). The free plan covers up to 6 developers.

   This must land **before** he runs `npm run dev`, or his backend provisions
   under a personal team of his own and you cannot see it.

3. **Send him the Google credentials** privately — `GOOGLE_CLIENT_ID` and
   `GOOGLE_CLIENT_SECRET`, the same pair the project already uses. He sets them
   on his own backend; they never enter the repo.

## Once his backend exists

He sends you a `CONVEX_DEPLOYMENT` name. Add its callback address to the
existing Google OAuth client in the Google Cloud Console, alongside the ones
already there:

```
https://<his-deployment>.convex.site/api/auth/callback/google
```

Leave Authorised JavaScript origins empty — see `auth-setup.md` for why. Until
you do this, his sign-in fails with `redirect_uri_mismatch` and nothing on his
side can fix it.

## Day to day

His work arrives as draft pull requests. GitHub emails you when one opens.
Review the diff, comment inline, and merge when you are happy. He cannot merge,
and the ruleset means neither can anything running on his machine.

## Revoking access

Remove the repo collaborator, remove him from the Convex team, and delete the
extra redirect URI from the Google OAuth client. His local clone keeps working
against a backend he no longer has access to, which fails on its own.
