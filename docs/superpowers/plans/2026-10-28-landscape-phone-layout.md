# Landscape Phone Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On a phone held sideways, show the rack, the whole board and the scores at once, in three columns, with a compact header; and open the bag's letter list as a dialog on every screen size.

**Architecture:** One media query, `(orientation: landscape) and (max-height: 500px)`, defines "short landscape". CSS handles the layout through it. A small hook exposes the same query to React for the parts CSS cannot move: Hint and the notices go into the right column, the rack gets a two-wide grid, and Android's status bar is hidden. The `Board` and `Rack` elements must stay at the same place in the React tree in both layouts, so rotating the phone never remounts them and never loses placed tiles.

**Tech Stack:** React 19, TypeScript, CSS modules with tokens in `:root`, Vitest (happy-dom for `*.test.tsx`, node for `*.test.ts`), Capacitor 8.

**Spec:** `docs/superpowers/specs/2026-10-28-landscape-phone-layout-design.md`. Read it first. This plan argues from it.

## Global Constraints

- CSS modules and the existing tokens only. No inline styles, apart from the CSS custom properties the rack and board already set through `style`. No Tailwind.
- TypeScript only.
- The short-landscape query is exactly `(orientation: landscape) and (max-height: 500px)`. Define it once, in TypeScript, and repeat it verbatim in CSS with a comment pointing to the TypeScript constant.
- Nothing changes outside short landscape, except the bag dialog (Task 3).
- New dependency: `@capacitor/status-bar` pinned to exactly `8.0.4`, with no caret. Pin exact versions of anything else you add, at least two weeks old.
- Never run `convex` CLI commands. This work does not touch `convex/`.
- Verify with `npm run typecheck` and `npm test -- --no-file-parallelism`. Lint with `npm run lint:scoped`.
  - On this Mac, under Node 26, 4 tests in `src/lib/draft.test.ts` fail. That is a known, unrelated failure: they pass under Node 22 (`~/.nvm/versions/node/v22.23.4/bin`). Anything else failing is yours.
- Comments match the codebase: full sentences that explain why, in the same voice as the surrounding code.
- Commit after each task, ending the message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Run `git branch --show-current` right before each commit. Never push.
- Shell notes: `npx cap` gets rewritten by a hook, so use `./node_modules/.bin/cap`. Gradle needs `JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"`. adb is at `~/Library/Android/sdk/platform-tools/adb`.

## Review Focus

1. **Rotating mid-game keeps placed tiles, the zoom, and any drag in progress.** Expected: tiles already on the board stay there, and nothing remounts. Covered by Task 7, step 5, a manual check on the emulator.
2. **Dragging a tile within the two-wide rack.** Expected: dropping a tile on the second row lands it in the slot under the finger, and the other tiles slide in two dimensions, not along one long row. Covered by Task 4's tests and Task 5's transform test.
3. **The bag dialog when the game ends while it is open.** Scoreboard stops rendering `BagContents` when the game is finished. Expected: the dialog goes away with it and nothing is left stuck on screen. Covered by Task 3's unmount test.
4. **Closing the bag dialog returns focus to the "tiles left" button.** Expected: keyboard and screen-reader users land back where they were. Covered by Task 3's focus test.
5. **The status bar on the web and on iOS.** Expected: nothing is called, and nothing throws. Covered by Task 2's tests.

---

### Task 0: Workspace setup

- [ ] **Step 1:** Confirm this workspace is on a new branch, `bhdoggett/landscape`, based on local `main` or `bhdoggett/app-store`, **not** `origin/main`. Check with `git log --oneline -1 -- capacitor.config.ts`, which must show a commit.
- [ ] **Step 2:** If the spec and this plan are not in the workspace, copy them in from `/Users/bdoggett/orca/workspaces/kraftwerd/app-store/docs/superpowers/`.
- [ ] **Step 3:** Copy the gitignored env file: `cp ~/orca/workspaces/kraftwerd/app-store/.env.local .env.local`. The app build fails without it.
- [ ] **Step 4:** Run `npm install`. Then run `npm run typecheck`, and run `npm test -- --no-file-parallelism`, which should fail only the 4 known draft tests.
- [ ] **Step 5:** Commit the spec and the plan (`docs: landscape phone layout spec and plan`).

### Task 1: The short-landscape query, shared

**Files:**
- Create: `src/lib/useShortLandscape.ts`
- Test: `src/lib/useShortLandscape.test.tsx`

**Interfaces:**
- Produces:
  - `export const SHORT_LANDSCAPE = "(orientation: landscape) and (max-height: 500px)"`
  - `export function useShortLandscape(): boolean`. It reads `window.matchMedia(SHORT_LANDSCAPE)`, updates on its `change` event, and is `false` when `matchMedia` is missing.

- [ ] **Step 1: Write failing tests.** Stub `window.matchMedia` with a fake that records the query and lets the test fire `change`.
  - `test("is true when the screen is short and sideways")`: the fake matches. Expect `renderHook(useShortLandscape).result.current` to be `true`, and the recorded query to equal `SHORT_LANDSCAPE`.
  - `test("follows the phone as it turns")`: start false, fire change to matches=true inside `act`, then expect `true`.
  - `test("is false without matchMedia")`: delete the stub, then expect `false`.
- [ ] **Step 2:** Run `npx vitest run src/lib/useShortLandscape.test.tsx`. Expected: FAIL, module not found.
- [ ] **Step 3:** Implement it with `useSyncExternalStore`.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit (`feat(layout): one definition of a phone held sideways`).

### Task 2: Compact header and Android status bar

**Files:**
- Modify: `src/App.module.css` (`.header`, `.markTile`, `.main`)
- Create: `src/lib/statusBar.ts`
- Test: `src/lib/statusBar.test.ts`
- Modify: `src/App.tsx`, to call the hook in `App`
- Modify: `package.json` and `package-lock.json` (`@capacitor/status-bar` exactly `8.0.4`)

**Interfaces:**
- Consumes: `SHORT_LANDSCAPE`, `useShortLandscape()` (Task 1)
- Produces:
  - `export async function syncStatusBar(shortLandscape: boolean): Promise<void>`
  - `export function useStatusBarForLandscape(): void`, which calls `syncStatusBar(useShortLandscape())` in an effect.

- [ ] **Step 1: Write failing tests.** Use `vi.mock("@capacitor/status-bar")` and `vi.mock("@capacitor/core")` to control `Capacitor.getPlatform()`.
  - `test("hides the bar on Android held sideways")`: platform `"android"`, `syncStatusBar(true)`. Expect `StatusBar.hide` called once.
  - `test("shows it again when Android turns upright")`: platform `"android"`, `syncStatusBar(false)`. Expect `StatusBar.show` called once.
  - `test("leaves iOS alone")`: platform `"ios"`. Expect neither called, for both `true` and `false`.
  - `test("does nothing on the web")`: platform `"web"`. Expect neither called.
  - `test("a plugin failure does not throw")`: `hide` rejects. Expect `await syncStatusBar(true)` to resolve.
- [ ] **Step 2:** Run `npx vitest run src/lib/statusBar.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Run `npm install --save-exact @capacitor/status-bar@8.0.4`. Implement `syncStatusBar` and `useStatusBarForLandscape`, then call the hook once at the top of `App()`.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5: Add the compact header.** In `src/App.module.css`, add an `@media (orientation: landscape) and (max-height: 500px)` block, with a comment naming `SHORT_LANDSCAPE`:
  - `.header`: `position: static`, about 28px of content height, vertical padding `var(--space-1)`. Keep the `env(safe-area-inset-*)` maxima.
  - `.markTile`: 22px square, `font-size: var(--text-sm)`.
  - `.main`: `--main-pad: var(--space-2)`.

  It applies on every screen, as the spec says.
- [ ] **Step 6:** Run `npm run cap:sync`, which should show the status-bar plugin in both platforms. Then run `npm run typecheck`.
- [ ] **Step 7:** Commit (`feat(layout): compact header and no Android status bar when sideways`).

### Task 3: The bag as a dialog, everywhere

**Files:**
- Modify: `src/components/BagContents/BagContents.tsx` and `BagContents.module.css`
- Test: `src/components/BagContents/BagContents.test.tsx`

**Interfaces:**
- Consumes: `Modal` from `src/components/Modal/Modal.tsx` (`onDismiss`, `label`, `returnFocusTo`)
- Produces: the same props as today (`left`, `unseen`). The summary button stays in place. Its `aria-expanded` becomes `aria-haspopup="dialog"`.

- [ ] **Step 1: Update the tests.**
  - `open()` now clicks `getByRole("button", { name: /tiles left/ })`.
  - The existing letter tests keep their assertions, scoped with `within(screen.getByRole("dialog"))`.
  - Add these tests:
    - `test("opens as a dialog")`: expect `getByRole("dialog", { name: /still out there/i })`.
    - `test("Escape closes it")`: `fireEvent.keyDown(document, { key: "Escape" })`, then expect `queryByRole("dialog")` to be null.
    - `test("the close button closes it")`: click `getByRole("button", { name: "Close" })`, then expect no dialog.
    - `test("closing returns focus to the tiles-left button")`: close it, then expect `document.activeElement` to be that button.
    - `test("goes away when the bag does")`: `unmount()` while open, then expect no dialog in `document.body`.
  - Keep the axe test.
- [ ] **Step 2:** Run `npx vitest run src/components/BagContents`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement it.**
  - When `open`, render the note and the letters inside `<Modal onDismiss={close} label="Still out there" returnFocusTo={summaryRef}>`, plus a "Close" button.
  - Drop `.chevronOpen`. The chevron becomes a plain "opens" mark.
  - Move the `.letters` grid styles so they work inside the modal panel.
- [ ] **Step 4:** Run the same command. Expected: PASS. Then run `npx vitest run src/components/Scoreboard`. Expected: PASS. Update any Scoreboard test that relied on in-place expansion.
- [ ] **Step 5:** Commit (`feat(bag): the letter list opens as a dialog`).

### Task 4: Rack geometry in two dimensions

**Files:**
- Modify: `src/lib/rackGeometry.ts`
- Test: `src/lib/rackGeometry.test.ts`

**Interfaces:**
- Produces:
  - `export function slotOffset(from: number, to: number, columns: number): { x: number; y: number }`. This is how many slots across and down a tile moves, laid out row by row. With `columns <= 0`, everything is in one row.
  - `export function slotAt(x: number, y: number, slots: readonly { left: number; top: number; width: number; height: number }[]): number`. It returns the position a drop at `(x, y)` aims at, with the rack's own coordinates in and out: before the first slot gives 0, past the last gives `slots.length`.
  - `rackSlotUnder(clientX, clientY)` keeps its signature, and now builds `slots` from `offsetLeft`, `offsetTop`, `offsetWidth` and `offsetHeight` and calls `slotAt`.

- [ ] **Step 1: Write failing tests.**
  - `slotOffset(0, 3, 2)` equals `{ x: 1, y: 1 }`.
  - `slotOffset(3, 0, 2)` equals `{ x: -1, y: -1 }`.
  - `slotOffset(1, 2, 2)` equals `{ x: -1, y: 1 }`.
  - `slotOffset(0, 3, 0)` equals `{ x: 3, y: 0 }`, today's single row.
  - `slotAt` on a 2-wide grid of 40px slots with a 4px gap:
    - The centre of the slot at row 1, column 0 gives 2.
    - A point right of the last slot on row 0 gives 2.
    - A point left of everything gives 0.
    - A point below the last row gives `slots.length`.
  - `slotAt` on a single row matches today's behaviour: before the first slot gives 0, and inside slot `i` gives `i`.
- [ ] **Step 2:** Run `npx vitest run src/lib/rackGeometry.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement it. `slotAt` picks the row by `top` and `height` first, then the column within that row by `left` and `width`, so a single row behaves exactly as before.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit (`feat(rack): drop targets and slides in two dimensions`).

### Task 5: The rack as a column

**Files:**
- Modify: `src/components/Rack/Rack.tsx` (prop, transform at about line 197)
- Modify: `src/components/Rack/Rack.module.css`
- Test: `src/components/Rack/Rack.test.tsx`

**Interfaces:**
- Consumes: `slotOffset` (Task 4)
- Produces: a new optional prop on `Rack`, `columns?: number`. When set, the letters sit in a grid that many tiles wide, and the blank tile, with its count, sits as the cell after the last letter. The actions show icons only, in one row under the tiles, with Play below them. Leaving it out keeps today's rack exactly as it is.

- [ ] **Step 1: Write failing tests**, using the existing `draw()` helper.
  - `test("a two-wide rack slides a tile across and down")`: `columns: 2`, `letters: ["A","T","E","S"]`, `order: [0,1,2,3]`, `previewOrder: [1,2,3,0]`. Expect the "A" tile's `style.transform` to be `translate(calc(var(--rack-step) * 1), calc(var(--rack-step-y) * 1))`.
  - `test("a one-row rack still slides along its row")`: no `columns`, same orders. Expect `translateX(calc(var(--rack-step) * 3))`, unchanged from today.
  - `test("a two-wide rack keeps every action's name")`: with `columns: 2`, every action button still has its `aria-label`.
- [ ] **Step 2:** Run `npx vitest run src/components/Rack`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement it.**
  - Add `--rack-step-y: calc(var(--rack-tile-height) + var(--rack-gap))`.
  - With `columns`, use `slotOffset(slot, slot + shift, columns)` to build the 2D transform, and add `styles.columns` to `.rack`. That class sets the tiles container to `display: grid; grid-template-columns: repeat(var(--rack-columns), var(--rack-tile-width))`, with `--rack-columns` set from the prop.
  - Hide `.actionLabel`, and size tiles so a 2-wide rack fits a column about 104px wide.
- [ ] **Step 4:** Run the same command. Expected: PASS, including the existing tests.
- [ ] **Step 5:** Commit (`feat(rack): a rack that stands as a column`).

### Task 6: A board viewport that is a rectangle

**Files:**
- Modify: `src/components/Board/Board.tsx` (new prop, `.frame` class)
- Modify: `src/components/Board/Board.module.css` (`.frame`)
- Test: `src/components/Board/Board.test.tsx`

**Interfaces:**
- Produces: a new optional prop on `Board`, `fill?: boolean`. When set, the frame drops `aspect-ratio: 1` and fills its parent's height (`.frameFill { aspect-ratio: auto; height: 100%; }`). The fit logic already uses `min(width, height)`, and `.viewport` already centres the grid, so zoomed out the square board sits centred in the rectangle.

- [ ] **Step 1: Write a failing test.** `test("a filling board drops the square frame")`: render with `fill`, then expect the frame element to have the `frameFill` class. Find it the way the existing Board tests find elements; add a `data-board-frame` attribute if there is no handle.
- [ ] **Step 2:** Run `npx vitest run src/components/Board`. Expected: FAIL.
- [ ] **Step 3:** Implement it.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit (`feat(board): a viewport that can be wider than tall`).

### Task 7: The game screen's landscape layout

**Files:**
- Modify: `src/components/Game/Game.tsx` (about lines 1059 to 1720)
- Modify: `src/components/Game/Game.module.css`

**Interfaces:**
- Consumes: `useShortLandscape()` (Task 1), `Rack` `columns` (Task 5), `Board` `fill` (Task 6)

The layout comes out like this:

- `.layout` gets `styles.landscape` when `useShortLandscape()` is true, and also `styles.noRack` when `rackShown` is false.
- In `.landscape`, `.layout` is a 3-column grid: `auto minmax(0, 1fr) 170px`. The `.main` element becomes `display: contents`, so that `.rackSlot` takes column 1 and `.boardArea` takes column 2. Its other children are either moved to the side, as below, or placed in column 1 under the rack.
- `.side` is column 3, with `overflow-y: auto` and `max-height` set to the space under the header.
- The layout's height is the viewport minus the header: `100dvh` minus the header's height, using the same token the header sets. The page itself must not scroll.
- `.noRack` makes it 2 columns, `minmax(0, 1fr) 170px`.
- `.boardArea` in `.landscape`: `width: auto; height: 100%`. Pass `fill` to `Board`.
- Pass `columns={2}` to `Rack` in landscape.

What moves:

- When short landscape, render these at the **top of `.side`** instead of in `.main`, in this order: the final-round banner, the "Waiting for players" block, and the error alert. Render each in exactly one place; never in both.
- Render `HintBar` inside `.side`, directly after the play section (the words and the score) and before the multiplier key. The side order is Scoreboard (the bag is inside it), then play, then HintBar, then multipliers.
- Pass and Swap confirmations: in short landscape, render a compact version in the rack column, under the rack: a short line ("Pass?" or "Swap rack?"), a confirm button and a cancel button. The rack's actions row is hidden while it shows. Keep the full sentence for screen readers using `SrOnly`.
- The review bar and the finished-game block (`GameSummary`, Review turns, Play again) go in `.side` when short landscape. They are already in `.side` or under the board, so move only the review bar.
- `Board` and `Rack` must not move in the tree between the two layouts. Only the notices, `HintBar` and the review bar render conditionally in two places.

- [ ] **Step 1:** Implement the layout and the moves above.
- [ ] **Step 2:** Run `npm run typecheck && npm test -- --no-file-parallelism && npm run lint:scoped`. Expected: all pass except the 4 known draft tests.
- [ ] **Step 3: Check it on the Android emulator.**
  - Build and install: `npm run cap:sync`, then `cd android && ./gradlew installDebug` (with `JAVA_HOME` set), then `adb shell am start -n xyz.benapps.kraftwerd/.MainActivity`.
  - Start a game against the computer. Turn sideways using the emulator's rotate button.
  - Check:
    - Three columns, and no page scroll.
    - The whole board shows when zoomed out.
    - Zooming in fills the width and pans.
    - Dragging between the rack and the board works in both directions.
    - Reordering within the rack works on both rows.
    - The status bar is hidden.
- [ ] **Step 4: Check it on the iOS simulator** the same way. There is no Simulator.app on Xcode 27, so use `xcrun simctl boot`, `install`, `launch`, or Run in Xcode.
- [ ] **Step 5: Check rotation keeps the game.** Upright, place two tiles. Rotate to landscape, then back. Expected: both tiles still on the board, the score preview unchanged, no reload.
- [ ] **Step 6: Check upright and desktop are unchanged** except the bag dialog: an upright phone, and a desktop browser at 1280 by 800.
- [ ] **Step 7:** Commit (`feat(game): three columns on a phone held sideways`).

### Task 8: Finish

- [ ] **Step 1:** Run the full verification from the Global Constraints once more, on the final tree.
- [ ] **Step 2:** Report to the user what was checked on which device, and anything that did not fit, for example a column that had to scroll on a 360 by 800 phone. Do not push. Do not merge.
