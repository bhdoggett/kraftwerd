import type { CapacitorConfig } from "@capacitor/cli";

/**
 * The iOS and Android apps are this same web build, bundled into a native
 * shell. `npm run build` writes dist/, and `npx cap sync` copies it into
 * ios/ and android/.
 *
 * The bundled app is served from capacitor://localhost on iOS and
 * https://localhost on Android, not from the website's own origin. Better
 * Auth only completes a sign-in for origins listed in SITE_URL, so both need
 * adding there before sign-in can work inside the app.
 */
const config: CapacitorConfig = {
  appId: "xyz.benapps.kraftwerd",
  appName: "kraftwerd",
  webDir: "dist",
};

export default config;
