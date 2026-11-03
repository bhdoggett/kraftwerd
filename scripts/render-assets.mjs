/**
 * Bake the PNGs that the SVG marks are the masters for.
 *
 * Several consumers cannot read an SVG, so each mark is kept as a vector and
 * snapshotted to pixels for them: link-preview crawlers, several of which
 * will not render an SVG at all; iOS, which wants a fixed-size PNG for a
 * home-screen icon; and the iOS and Android apps' own icons. Edit the SVG,
 * run this, commit both.
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

/** Every web PNG that is baked, and the size the thing reading it asks for. */
const ASSETS = [
  // og:image. The dimensions are also declared in index.html, where crawlers
  // read them before fetching the file; the two have to agree.
  { name: "og", width: 1200, height: 630 },
  // apple-touch-icon: what iOS puts on a home screen.
  { name: "favicon", width: 180, height: 180 },
];

/**
 * Android's icon densities, as the pixel size of a 48dp legacy icon. An
 * adaptive icon's layers are 108dp, so 2.25 times that.
 */
const ANDROID_DENSITIES = [
  { name: "mdpi", size: 48 },
  { name: "hdpi", size: 72 },
  { name: "xhdpi", size: 96 },
  { name: "xxhdpi", size: 144 },
  { name: "xxxhdpi", size: 192 },
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

/** The size a PNG says it is, and whether it carries alpha, from its IHDR. */
function pngHeader(path) {
  const header = readFileSync(path).subarray(16, 26);
  return {
    width: header.readUInt32BE(0),
    height: header.readUInt32BE(4),
    // Colour type 6 is RGBA; 2 is RGB. Chrome writes RGB when every pixel
    // came out opaque.
    alpha: header[9] === 6,
  };
}

/** The drawing inside an SVG file, without its <svg> wrapper or comments. */
function inner(svg) {
  return svg
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/^[\s\S]*?<svg[^>]*>/, "")
    .replace(/<\/svg>\s*$/, "");
}

/**
 * Snapshot an SVG to a PNG of the given size.
 *
 * `opaque` is checked rather than assumed, both ways: the App Store refuses
 * an app icon with an alpha channel, and an adaptive icon's front layer that
 * came out opaque would hide the board behind it.
 */
function render(svg, { out, width, height, round = false, opaque }) {
  // The SVG is sized by the page rather than by rewriting its own width and
  // height: its viewBox does the scaling, and an edit here cannot reach into
  // the drawing and resize something that happens to share those numbers.
  const page = join(work, "page.html");
  writeFileSync(
    page,
    `<html><head><style>html,body{margin:0;padding:0}` +
      // Pixels, from a box of a stated size. vw/vh look like the obvious way
      // to fill the shot and are not: headless lays the page out against a
      // viewport of its own, so the drawing came out enlarged and cropped.
      `#frame{width:${width}px;height:${height}px` +
      (round ? `;clip-path:circle(50%)` : ``) +
      `}svg{display:block;width:100%;height:100%}</style></head>` +
      `<body><div id="frame">${svg}</div></body></html>`,
  );

  shoot(
    `file://${page}`,
    // One device pixel per CSS pixel, so the file is the size it claims.
    "--force-device-scale-factor=1",
    // Transparent, so only what the drawing paints ends up in the file.
    "--default-background-color=00000000",
    `--window-size=${width},${height}`,
    `--screenshot=${out}`,
  );

  const actual = pngHeader(out);
  const name = out.slice(ROOT.length + 1);
  if (actual.width !== width || actual.height !== height) {
    console.error(`${name} came out ${actual.width}x${actual.height}, wanted ${width}x${height}`);
    process.exit(1);
  }
  if (actual.alpha === opaque) {
    console.error(`${name} came out ${actual.alpha ? "with" : "without"} transparency`);
    process.exit(1);
  }
  console.log(`${name}  ${width}x${height}`);
}

for (const { name, width, height } of ASSETS) {
  const svg = readFileSync(join(ROOT, "public", `${name}.svg`), "utf8");
  render(svg, { out: join(ROOT, "public", `${name}.png`), width, height, opaque: true });
}

// The iOS app icon is the favicon as it is: iOS rounds the corners itself,
// and the favicon already leaves board there for it to round away. One
// 1024 square; Xcode makes every other size from it.
render(readFileSync(join(ROOT, "public", "favicon.svg"), "utf8"), {
  out: join(ROOT, "ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png"),
  width: 1024,
  height: 1024,
  opaque: true,
});

// Android: the adaptive icon's two layers, and for phones older than
// Android 8 the two flattened into a square and a round icon. Those show the
// middle 72 of the 108 square, which is all a launcher ever shows.
const foreground = readFileSync(join(ROOT, "assets", "app-icon-foreground.svg"), "utf8");
const background = readFileSync(join(ROOT, "assets", "app-icon-background.svg"), "utf8");
const flattened =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="18 18 72 72">` +
  `${inner(background)}${inner(foreground)}</svg>`;

for (const { name, size } of ANDROID_DENSITIES) {
  const dir = join(ROOT, "android/app/src/main/res", `mipmap-${name}`);
  const layer = size * 2.25;
  render(foreground, { out: join(dir, "ic_launcher_foreground.png"), width: layer, height: layer, opaque: false });
  render(background, { out: join(dir, "ic_launcher_background.png"), width: layer, height: layer, opaque: true });
  render(flattened, { out: join(dir, "ic_launcher.png"), width: size, height: size, opaque: true });
  render(flattened, { out: join(dir, "ic_launcher_round.png"), width: size, height: size, round: true, opaque: false });
}

rmSync(work, { recursive: true, force: true });
