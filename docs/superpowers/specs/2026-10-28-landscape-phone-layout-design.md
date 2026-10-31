# Landscape phone layout for the game screen

## Why

kraftwerd now ships as an iOS and Android app (Capacitor). Turned sideways
on a phone, the game screen falls apart. The header plus Android's status bar
take about a quarter of the height. The game then uses the stacked layout
meant for upright phones, so the board is cut off and the rack sits below
the fold. Landscape is a way people will hold a phone to play, and it should
feel designed for, not tolerated.

Success: on a phone held sideways, the rack, the action buttons, the whole
board (zoomed out) and the scores are all on screen at once, without
scrolling the page.

## Goals

- A three-column game layout for phones in landscape: rack and actions on
  the left, the board in the middle, and everything you read on the right.
- The board's visible area is a rectangle that fills the middle column. It is
  not a square. The board itself stays square (same rules, same size).
- A compact header in that layout.
- Android's status bar hidden in that layout, the way iOS hides it in
  landscape.
- The bag's letter list opens as a popup over the board, **on every screen
  size**, not only in landscape (see "The bag, everywhere").

## Non-goals

- No change to upright phones, tablets, or desktop, except the bag popup.
- No change to the game rules, the board size, or what any control does.
- No new features. Everything in the layout already exists on the game
  screen today, and only moves.

## Anti-goals

- Anything that needs page scrolling to reach the rack, the Play button, or
  the board in landscape.
- A board that is cut off when zoomed all the way out.
- Breaking the existing layouts in order to get this one.

## When it applies

Landscape screens that are short: roughly `(orientation: landscape) and
(max-height: 500px)`. That is a phone turned sideways. The exact cut-off is
the builder's call (my call: 500px), as long as an iPad in landscape and a
laptop browser window are not caught by it.

This applies in the website on a phone too, not only in the apps. It is CSS,
so it would anyway.

## Layout, decided with the user

Mockup: `.superpowers/brainstorm/67783-1793243551/content/landscape-layout-v4.html`
(the last one shown, layout "A").

### Left column: the rack

- The rack's tiles stacked in a grid two tiles wide, instead of one row.
  Seven letters plus the blank tile fill two columns of four.
- The blank tile keeps its count of blanks left, as it does today.
- Below the tiles: the action buttons (shuffle, recall, swap, pass) two by
  two, **icons only**. (Icons in a row came out 19px wide, too small to tap.) The rack already hides the text labels below a container
  width; the narrow column should land in that case. Every button keeps its
  `aria-label`.
- Below those: the Play button.
- Drag and drop between the rack and the board must keep working across the
  columns.

### Middle column: the board

- The board's viewport fills the column: full width of the column, full
  height left under the header. It is a rectangle.
- Zoomed all the way out ("fit"), the whole board shows. Because the board is
  square and the viewport is wider than tall, it fits the height and leaves
  space at the sides. The board sits centred in that space. The low zoom steps
  also leave bands at the sides, until the board is wider than the viewport.
- Zoomed in, the board fills the rectangle and you drag to pan, as today.
- `Board.tsx` already measures its box and fits with `min(width, height)`.
  Today the box is forced square by `.boardArea` (`width: min(100%, 72vh)`).
  In landscape the box stops being square.
- What is laid over the board today (the score tally on its corner, a refused
  tile's message, the zoom buttons) stays laid over the board's viewport.

### Right column: what you read

Top to bottom:

1. Whose turn it is and the scores (the Scoreboard as it is), with Quit.
2. The bag, as its one-line summary ("85 of 99 tiles left" with its toggle).
   Opening it shows the letter list as a popup over the board (below).
3. This play: the words being made and their score, then Hint and "Words in
   your rack". Hint and "Words in your rack" move here from above the board,
   so the board gets the full height.
4. The word multiplier key, on one line.

The column is narrower than today's side column. If its content is taller
than the screen, the column scrolls by itself; the board and the rack do not
move.

Notices that today sit above or below the board need a place that does not
take height from the board. They go at the top of the right column: the
final-round banner, the "Waiting for players" banner with its seat picker
and copy-link button, and the error alert.

### Pass and Swap confirmations

Today each is a sentence plus two buttons under the rack. In landscape, the
confirmation replaces the action buttons in the rack column, as a short line
with a confirm button and a cancel button, so the thumb stays where it was.
The full sentence stays available to screen readers.

### When there is no rack

The rack only shows while you hold a seat in a game still being played and
you are not reviewing turns (`rackShown` in `Game.tsx`). When it is hidden
(watching, a finished game, turn review), landscape uses two columns: the
board and the right column. The review slider with its back and forward
buttons, the finished-game summary (`GameSummary`), "Review turns" and "Play
again" all go in the right column, so the board keeps its full height.

### The bag, everywhere

Today the bag's letter list (`BagContents`) opens in place and pushes what is
under it down. From now on it opens as a dialog fixed in the middle of the
screen, like the app's other dialogs (`Modal`), in every layout: desktop,
upright phone, and landscape phone. On an upright phone the bag's summary is
below the board, so a popup pinned to the board would often be off screen.
The user mostly plays on a phone. One behaviour everywhere, one code path.

While it is open it covers the board and blocks it: no placing tiles until it
is closed. Escape, a tap outside, and a close button close it.

### Header

Applies to every screen held sideways under the cut-off (lobby, account,
sign-in too), not only the game. My call: simpler, and the lobby gains the
same room.

- Compact: about 28px tall, with smaller K/W tiles and tighter padding.
- Still clears the notch and rounded corners (`env(safe-area-inset-*)`).
- Not sticky in this layout.

### Android status bar

- Hidden on any screen while the phone is in short landscape (one listener
  for the whole app, my call), shown again when it goes back to upright. Needs `@capacitor/status-bar`, a new native dependency. Pin an
  exact version at least two weeks old, and run `npm run cap:sync` so it
  lands in both native projects.
- iOS already hides the status bar in landscape; leave it alone.
- On the website the plugin does nothing; it must not throw.

## Constraints

- CSS modules and the existing design tokens. No inline styles, no Tailwind.
- TypeScript only.
- Verify with `npm run typecheck` and `npm test -- --no-file-parallelism`.
  On this Mac the 4 tests in `src/lib/draft.test.ts` fail under Node 26 and
  pass under the repo's Node (see `.nvmrc`); that is not a regression.
- Never run `convex` CLI commands. This work should not touch `convex/`.
- Try it on the Android emulator and the iOS simulator, in both
  orientations, before calling it done. Rotating the phone mid-game must
  switch layouts without losing tiles placed on the board.

## Left to the builder

- Whether the layout is done with a media query on the game's grid, a
  container query, or a small hook. Prefer CSS.
- Exact tile and column sizes, as long as everything fits a 390 by 844 phone
  turned sideways (and a 360 by 800 Android phone).
- How the bag popup is placed and dismissed, following how the app's other
  popovers and modals work (Escape and a tap outside should close it).
- Whether the rack becomes vertical by a modifier class or by its container
  width.
