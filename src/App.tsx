import { Authenticated, Unauthenticated, useConvexAuth, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import styles from "./App.module.css";
import { Game } from "./components/Game";
import { Lobby } from "./components/Lobby";
import { Rules } from "./components/Rules";
import { authClient } from "./lib/auth-client";
import { navigate, useRoute } from "./router";

export default function App() {
  const route = useRoute();

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <button
          type="button"
          className={styles.brandButton}
          onClick={() => navigate({ name: "lobby" })}
        >
          <h1 className={styles.brand}>kraftwerd</h1>
        </button>
        {/* Signed out there is no lobby to go back to, and the route is
            about to be irrelevant anyway. */}
        <Authenticated>
          {route.name === "game" && (
            <button
              type="button"
              className={styles.link}
              onClick={() => navigate({ name: "lobby" })}
            >
              Back to lobby
            </button>
          )}
        </Authenticated>
        <span className={styles.spacer} />
        <Rules />
        <SignOutButton />
      </header>

      <main className={styles.main}>
        <Authenticated>
          {route.name === "game" ? (
            <Game
              gameId={route.gameId as Id<"games">}
              onLeave={() => navigate({ name: "lobby" })}
            />
          ) : (
            <Lobby onOpen={(gameId) => navigate({ name: "game", gameId })} />
          )}
        </Authenticated>
        <Unauthenticated>
          <SignInForm />
        </Unauthenticated>
      </main>
    </div>
  );
}

function SignOutButton() {
  const { isAuthenticated } = useConvexAuth();
  const viewer = useQuery(api.users.viewer);

  if (!isAuthenticated) return null;

  return (
    <>
      <span className={styles.tagline}>{viewer?.name ?? "Signed in"}</span>
      <button
        type="button"
        className={styles.signOut}
        onClick={() => {
          // Leave the game route behind, so signing back in lands in the lobby
          // rather than a game the next person may not be in.
          void authClient.signOut().then(() => navigate({ name: "lobby" }));
        }}
      >
        Sign out
      </button>
    </>
  );
}

function SignInForm() {
  const [error, setError] = useState<string | null>(null);
  const status = useQuery(api.users.authStatus);
  const configured = status?.googleConfigured ?? true;

  return (
    <div className={styles.auth}>
      <p className={styles.tagline}>
        Build word squares against your friends.
      </p>
      <button
        type="button"
        className={styles.google}
        disabled={!configured}
        onClick={() => {
          setError(null);
          void authClient
            .signIn
            .social({
              provider: "google",
              // Back to the page they were on, not the root: someone opening
              // an invite link signs in first, and sending them to the lobby
              // afterwards loses the game they were invited to.
              callbackURL: window.location.href,
            })
            .catch((err: unknown) => {
              setError(err instanceof Error ? err.message : String(err));
            });
        }}
      >
        <GoogleMark />
        Continue with Google
      </button>
      {!configured && (
        <div className={styles.error}>
          Google sign-in is not configured on this deployment yet. Set
          GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET with{" "}
          <code>npx convex env set</code> — see <code>docs/auth-setup.md</code>.
        </div>
      )}
      {error && <div className={styles.error}>Could not sign in: {error}</div>}
    </div>
  );
}

/** Google's brand mark, inlined so the page makes no third-party requests. */
function GoogleMark() {
  return (
    <svg className={styles.googleMark} viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  );
}
