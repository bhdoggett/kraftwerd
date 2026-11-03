import { Capacitor } from "@capacitor/core";
import { SocialLogin } from "@capgo/capacitor-social-login";
import { authClient } from "./auth-client";

/**
 * Sign in with Google, the way that works where the app is running.
 *
 * On the website that is Better Auth's redirect to Google and back. Inside
 * the apps it cannot be: the page is served from capacitor://localhost on
 * iOS and https://localhost on Android, neither of which a browser can
 * redirect back to. There Google's native sheet signs the player in and
 * hands over an ID token, and Better Auth turns that into a session without
 * leaving the app.
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

/**
 * The plugin wants configuring once, before its first sign-in.
 *
 * Each platform names a different client. iOS signs in as the iOS client,
 * so its tokens are addressed to that. Android signs in as the web client:
 * Google recognises the app itself by its package name and signing key,
 * registered as an Android client, but addresses the token to the web
 * client named here. The server accepts both.
 */
function initialized(): Promise<void> {
  const ios = Capacitor.getPlatform() === "ios";
  const name = ios ? "VITE_GOOGLE_IOS_CLIENT_ID" : "VITE_GOOGLE_WEB_CLIENT_ID";
  const clientId = (
    ios ? import.meta.env.VITE_GOOGLE_IOS_CLIENT_ID : import.meta.env.VITE_GOOGLE_WEB_CLIENT_ID
  ) as string | undefined;
  if (!clientId) {
    return Promise.reject(new Error(`This build has no ${name}, so Google sign-in cannot start.`));
  }

  const google = ios ? { iOSClientId: clientId } : { webClientId: clientId };
  initializing ??= SocialLogin.initialize({ google }).catch((err: unknown) => {
    // Let the next tap try again rather than failing forever.
    initializing = undefined;
    throw err;
  });
  return initializing;
}
