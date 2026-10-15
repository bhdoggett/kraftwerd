/**
 * Bake the PNGs that public/*.svg are the masters for.
 *
 * Two consumers cannot read an SVG, so each mark is kept as a vector and
 * snapshotted to pixels for them: link-preview crawlers, several of which
 * will not render an SVG at all, and iOS, which wants a fixed-size PNG for
 * a home-screen icon. Edit the SVG, run this, commit both.
 *
 * The renderer is the Chrome already on the machine rather than a library.
 * It used to have to be: the marks were set in Futura, and matching a system
 * font is the one thing a bundled rasteriser cannot do. Every letter in them
 * is an outline now, so nothing here depends on what fonts are installed.
 *
 * Usage: node scripts/render-assets.mjs
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Every PNG that is baked, and the size the thing reading it asks for. */
const ASSETS = [
  // og:image. The dimensions are also declared in index.html, where crawlers
  // read them before fetching the file; the two have to agree.
  { name: "og", width: 1200, height: 630 },
  // apple-touch-icon: what iOS puts on a home screen.
  { name: "favicon", width: 180, height: 180 },
];

function findChrome() {
  const candidates = [
    process.env.CHROME,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);

  const found = candidates.find((path) => existsSync(path));
  if (found === undefined) {
    console.error("No Chrome found. Set CHROME to the binary and run again.");
    process.exit(1);
  }
  return found;
}

const chrome = findChrome();
const work = mkdtempSync(join(tmpdir(), "kraftwerd-assets-"));

function shoot(url, ...flags) {
  execFileSync(
    chrome,
    [
      "--headless",
      "--disable-gpu",
      // No --user-data-dir: pointing headless at a fresh profile directory
      // hangs it here, and it makes its own throwaway one anyway.
      //
      // Sandboxing needs a user namespace that CI containers often do not
      // give; on a desktop it is there and stays on.
      ...(process.env.CI ? ["--no-sandbox"] : []),
      "--hide-scrollbars",
      ...flags,
      url,
    ],
    { stdio: "ignore" },
  );
}

/** The size a PNG says it is, read straight out of its IHDR header. */
function pngSize(path) {
  const header = readFileSync(path).subarray(16, 24);
  return { width: header.readUInt32BE(0), height: header.readUInt32BE(4) };
}

for (const { name, width, height } of ASSETS) {
  const svg = readFileSync(join(ROOT, "public", `${name}.svg`), "utf8");
  // The SVG is sized by the page rather than by rewriting its own width and
  // height: its viewBox does the scaling, and an edit here cannot reach into
  // the drawing and resize something that happens to share those numbers.
  const page = join(work, `${name}.html`);
  writeFileSync(
    page,
    `<html><head><style>html,body{margin:0;padding:0}` +
      // Pixels, from a box of a stated size. vw/vh look like the obvious way
      // to fill the shot and are not: headless lays the page out against a
      // viewport of its own, so the drawing came out enlarged and cropped.
      `#frame{width:${width}px;height:${height}px}` +
      `svg{display:block;width:100%;height:100%}</style></head>` +
      `<body><div id="frame">${svg}</div></body></html>`,
  );

  const out = join(ROOT, "public", `${name}.png`);
  shoot(
    `file://${page}`,
    // One device pixel per CSS pixel, so the file is the size it claims.
    "--force-device-scale-factor=1",
    // Transparent, so only what the drawing paints ends up in the file.
    "--default-background-color=00000000",
    `--window-size=${width},${height}`,
    `--screenshot=${out}`,
  );

  const actual = pngSize(out);
  if (actual.width !== width || actual.height !== height) {
    console.error(
      `${name}.png came out ${actual.width}x${actual.height}, wanted ${width}x${height}`,
    );
    process.exit(1);
  }
  console.log(`public/${name}.png  ${width}x${height}`);
}

rmSync(work, { recursive: true, force: true });
