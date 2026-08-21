/**
 * Let Node run the TypeScript sources directly.
 *
 * The shared modules import each other with .js specifiers, which is what
 * TypeScript's ESM output needs and what Convex expects. Node's built-in type
 * stripping does not rewrite those, so this points them at the .ts file when
 * there is no .js beside it. Nothing ships with it: it exists so scripts can
 * run the same engine the app does, rather than a copy.
 */
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { register } from "node:module";

if (!process.env.TS_RESOLVE_CHILD) {
  process.env.TS_RESOLVE_CHILD = "1";
  register(import.meta.url);
}

export async function resolve(specifier, context, next) {
  if (specifier.startsWith(".") && specifier.endsWith(".js")) {
    const asTs = new URL(specifier.replace(/\.js$/, ".ts"), context.parentURL);
    if (existsSync(fileURLToPath(asTs))) return next(asTs.href, context);
  }
  return next(specifier, context);
}
