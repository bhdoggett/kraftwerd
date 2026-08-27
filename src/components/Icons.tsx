/**
 * Line icons, drawn rather than typed.
 *
 * Emoji and arrow glyphs render differently on every platform — some in
 * colour, some at the wrong weight, some as a box — so buttons that used them
 * looked accidental. These inherit `currentColor` and the button's size.
 */

interface IconProps {
  size?: number;
}

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  // An svg is an inline element by default, so it sits on the text baseline
  // and rides high inside a button. Blockifying it lets the button centre it.
  style: { display: "block" },
});

/** Take the tiles back off the board: an arrow returning to where it began. */
export function RecallIcon({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h11a5 5 0 0 1 0 10h-4" />
    </svg>
  );
}

/** Trade tiles in: two arrows passing each other. */
export function TradeIcon({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M8 3v18" />
      <path d="m4 7 4-4 4 4" />
      <path d="M16 21V3" />
      <path d="m20 17-4 4-4-4" />
    </svg>
  );
}

/** Shuffle the rack: two paths crossing. */
export function ShuffleIcon({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M3 7h4l10 10h4" />
      <path d="M3 17h4L17 7h4" />
      <path d="m18 4 3 3-3 3" />
      <path d="m18 14 3 3-3 3" />
    </svg>
  );
}

export function SunIcon({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <circle cx="12" cy="12" r="4.5" />
      {/* Eight rays, each the same length and the same distance out, so the
          drawing is symmetric about the centre of the box. */}
      <path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3" />
      <path d="M4.6 4.6 6.7 6.7M17.3 17.3l2.1 2.1M19.4 4.6 17.3 6.7M6.7 17.3l-2.1 2.1" />
    </svg>
  );
}

export function MoonIcon({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
    </svg>
  );
}

/**
 * Follow the system: a circle, half filled. Squeezing a sun and a moon into
 * one 24px box made both illegible; this reads at any size.
 */
export function SystemIcon({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <circle cx="12" cy="12" r="8" />
      {/* The filled half is drawn as its own arc rather than clipped, so it
          lands exactly on the circle it fills. */}
      <path d="M12 4a8 8 0 0 1 0 16Z" fill="currentColor" stroke="none" />
    </svg>
  );
}

/**
 * The rules. Just the mark, no ring: the button it sits in is already a
 * circle, and a circle drawn inside a circle reads as a mistake.
 */
export function HelpIcon({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      {/* Drawn to sit centred in the box: the hook and the dot together span
          y 6.2 to 17.6, and the hook spans x 9 to 15. */}
      <path d="M9 9.2a3 3 0 1 1 3 3.4v1.4" />
      <path d="M12 17.6h.01" />
    </svg>
  );
}

/**
 * The menu: three tiles, drawn the way the board draws one — a coloured face
 * inside an ink edge, square like every tile in the game.
 */
export function MoreIcon({ size = 16 }: IconProps) {
  /*
   * A face inside an edge, like a tile on the board. The stroke is centred on
   * the path, so half of it sits outside the square: gaps are measured from
   * the outside of the ink, not from the face.
   */
  const tile = (x: number) => (
    <rect
      x={x}
      y={9}
      width={5}
      height={5}
      strokeWidth={1.2}
      /*
       * Through style, not the fill and stroke attributes: a presentation
       * attribute is parsed as an SVG value and var() is not one, so it falls
       * back to the inherited paint — which is how these ended up ink on ink.
       */
      style={{ fill: "var(--menu-face)", stroke: "var(--menu-mark)" }}
    />
  );

  return (
    <svg {...base(size)} viewBox="-1 0 26 24">
      {tile(0)}
      {tile(9.5)}
      {tile(19)}
    </svg>
  );
}
