import { Capacitor } from "@capacitor/core";
import { SocialLogin } from "@capgo/capacitor-social-login";
import { authClient } from "./auth-client";

/**
 * Sign in with Google, the way that works where the app is running.
 *
 * On the website that is Better Auth's redirect to Google and back. Inside
 * the iOS app it cannot be: the page is served from capacitor://localhost,
 * which no browser can redirect back to. There Google's native sheet signs
 * the player in and hands over an ID token, and Better Auth turns that into
 * a session without leaving the app.
 *
 * Rejects with a message fit to show the player.
 */
export async function signInWithGoogle(): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    await authClient.signIn.social({
      provider: "google",
      // Back to the page they were on, not the root: someone opening an
      // invite link signs in first, and sending them to the lobby afterwards
      // loses the game they were invited to.
      callbackURL: window.location.href,
    });
    return;
  }

  if (Capacitor.getPlatform() !== "ios") {
    throw new Error("Google sign-in is not set up for Android yet.");
  }

  await initialized();

  // Ties the token to this attempt, so a token caught on its way here cannot
  // be replayed to sign in as somebody else. Google writes it into the token
  // and Better Auth checks it matches.
  const nonce = crypto.randomUUID();

  const { result } = await SocialLogin.login({
    provider: "google",
    options: { nonce },
  });
  if (result.responseType !== "online" || !result.idToken) {
    throw new Error("Google did not return an ID token.");
  }

  // Unlike the redirect, this answers with an error rather than throwing.
  const { error } = await authClient.signIn.social({
    provider: "google",
    idToken: { token: result.idToken, nonce },
  });
  if (error) {
    throw new Error(error.message ?? "Google sign-in failed.");
  }
}

let initializing: Promise<void> | undefined;

/** The plugin wants configuring once, before its first sign-in. */
function initialized(): Promise<void> {
  const iOSClientId = import.meta.env.VITE_GOOGLE_IOS_CLIENT_ID as string | undefined;
  if (!iOSClientId) {
    return Promise.reject(
      new Error("This build has no VITE_GOOGLE_IOS_CLIENT_ID, so Google sign-in cannot start."),
    );
  }

  initializing ??= SocialLogin.initialize({ google: { iOSClientId } }).catch((err: unknown) => {
    // Let the next tap try again rather than failing forever.
    initializing = undefined;
    throw err;
  });
  return initializing;
}
