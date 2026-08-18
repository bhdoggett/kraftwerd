export interface RackConfig {
  /** Non-blank letters held at the start of a turn. */
  size: number;
  /** Relative draw weight per letter; letters at 0 are never drawn. */
  weights: Readonly<Record<string, number>>;
  vowels: string;
  /** Minimum vowels in a full rack, enforced by biasing the last draws. */
  minVowels: number;
  /** Most copies of any one letter a rack may hold. */
  maxDuplicates: number;
}

export interface Rack {
  letters: string[];
  /** One blank slot, refilled every turn whether or not it was used (§5). */
  blank: boolean;
}

function pick(pool: readonly string[], weights: RackConfig["weights"], rng: () => number): string {
  const total = pool.reduce((sum, letter) => sum + weights[letter]!, 0);
  let roll = rng() * total;
  for (const letter of pool) {
    roll -= weights[letter]!;
    if (roll < 0) return letter;
  }
  return pool[pool.length - 1]!;
}

/** Top up `keep` to a full rack. `rng` returns a float in [0, 1). */
export function refill(keep: readonly string[], rng: () => number, config: RackConfig): Rack {
  const { size, weights, vowels, minVowels, maxDuplicates } = config;
  const letters = [...keep].slice(0, size);
  const playable = Object.keys(weights).filter((l) => weights[l]! > 0);

  while (letters.length < size) {
    const counts = new Map<string, number>();
    for (const l of letters) counts.set(l, (counts.get(l) ?? 0) + 1);

    const vowelsHeld = letters.filter((l) => vowels.includes(l)).length;
    const slotsLeft = size - letters.length;
    // Once every remaining slot is needed to reach the floor, draw vowels only.
    const vowelsOnly = minVowels - vowelsHeld >= slotsLeft;

    let pool = playable.filter((l) => (counts.get(l) ?? 0) < maxDuplicates);
    if (vowelsOnly) {
      const vowelPool = pool.filter((l) => vowels.includes(l));
      if (vowelPool.length > 0) pool = vowelPool;
    }
    // Every letter is at its duplicate cap: relax rather than loop forever.
    if (pool.length === 0) pool = playable;

    letters.push(pick(pool, weights, rng));
  }

  return { letters, blank: true };
}
