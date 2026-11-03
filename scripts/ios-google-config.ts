/**
 * Write ios/google.xcconfig from VITE_GOOGLE_IOS_CLIENT_ID.
 *
 * Google's native sign-in sheet hands control back to the app through a URL
 * scheme, and that scheme has to be the iOS client ID reversed:
 * `1234-abcd.apps.googleusercontent.com` becomes
 * `com.googleusercontent.apps.1234-abcd`. Info.plist reads it from the build
 * setting this file defines, so the ID is only ever written down once, in
 * .env.local, and never committed.
 *
 * Read with Vite's own loader in production mode, so it sees exactly the
 * value the build that runs alongside it bakes into the app.
 *
 * Usage: node scripts/ios-google-config.ts
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "ios", "google.xcconfig");
const SUFFIX = ".apps.googleusercontent.com";

const clientId = loadEnv("production", ROOT, "VITE_").VITE_GOOGLE_IOS_CLIENT_ID;

if (!clientId) {
  // Not fatal: the app still builds and guest play still works. Only the
  // Google button fails, and it says why.
  console.warn(
    "ios-google-config: VITE_GOOGLE_IOS_CLIENT_ID is not set, so Google sign-in will not work in the iOS app.",
  );
  writeFileSync(OUT, "// VITE_GOOGLE_IOS_CLIENT_ID was not set.\n");
  process.exit(0);
}

if (!clientId.endsWith(SUFFIX)) {
  throw new Error(
    `ios-google-config: VITE_GOOGLE_IOS_CLIENT_ID should end in ${SUFFIX}. Is it the iOS client's ID?`,
  );
}

const reversed = `com.googleusercontent.apps.${clientId.slice(0, -SUFFIX.length)}`;

writeFileSync(
  OUT,
  `// Written by scripts/ios-google-config.ts. Do not edit or commit.\nGOOGLE_REVERSED_CLIENT_ID = ${reversed}\n`,
);
console.log("ios-google-config: wrote ios/google.xcconfig");
