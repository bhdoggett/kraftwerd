/**
 * Words the bot may consider, indexed for fast span matching.
 *
 * Scanning every word against every span was the first version and it was far
 * too slow to run thousands of games. For a span with letters already in it,
 * the posting lists answer "which words have T here and A there" directly, and
 * the letter masks throw out anything the rack cannot spell before the
 * expensive checks run.
 */
export interface LengthIndex {
  words: string[];
  /** Bit per distinct letter, for a subset test against the rack. */
  masks: Uint32Array;
  /** "position:letter" to the words that have it. */
  posting: Map<string, number[]>;
  /** Sorted letters to the words that spell them. */
  anagrams: Map<string, number[]>;
}

export interface WordIndex {
  byLength: Map<number, LengthIndex>;
  has: (word: string) => boolean;
}

export const bit = (letter: string) => 1 << (letter.charCodeAt(0) - 65);

function maskOf(word: string): number {
  let mask = 0;
  for (const letter of word) mask |= bit(letter);
  return mask;
}

export function indexWords(words: Iterable<string>, maxLength: number): WordIndex {
  const byLength = new Map<number, LengthIndex>();
  const all = new Set<string>();

  for (const raw of words) {
    const word = raw.toUpperCase();
    all.add(word);
    if (word.length < 2 || word.length > maxLength) continue;

    let index = byLength.get(word.length);
    if (index === undefined) {
      index = { words: [], masks: new Uint32Array(0), posting: new Map(), anagrams: new Map() };
      byLength.set(word.length, index);
    }
    const at = index.words.length;
    index.words.push(word);

    const sorted = [...word].sort().join("");
    const same = index.anagrams.get(sorted);
    if (same === undefined) index.anagrams.set(sorted, [at]);
    else same.push(at);
    for (let i = 0; i < word.length; i++) {
      const key = `${i}:${word[i]}`;
      const list = index.posting.get(key);
      if (list === undefined) index.posting.set(key, [at]);
      else list.push(at);
    }
  }

  for (const index of byLength.values()) {
    index.masks = Uint32Array.from(index.words, maskOf);
  }

  return { byLength, has: (word) => all.has(word) };
}

/**
 * Words of length `length` that the rack can spell outright.
 *
 * A span with nothing in it used to be matched by scanning every word of that
 * length, for every such span — which is where the time went. There are at
 * most 35 ways to choose 5 letters from a rack of 7, so asking the other way
 * round is thousands of times cheaper.
 */
export function rackWords(index: LengthIndex, letters: readonly string[], length: number): number[] {
  if (letters.length < length) return [];

  const found: number[] = [];
  const chosen: string[] = [];

  const walk = (from: number) => {
    if (chosen.length === length) {
      const hits = index.anagrams.get([...chosen].sort().join(""));
      if (hits !== undefined) found.push(...hits);
      return;
    }
    for (let i = from; i < letters.length; i++) {
      // Identical letters at the same depth give the same subset twice.
      if (i > from && letters[i] === letters[i - 1]) continue;
      chosen.push(letters[i]!);
      walk(i + 1);
      chosen.pop();
    }
  };

  walk(0);
  return found;
}

/** Word indices matching every fixed letter, smallest posting list first. */
/**
 * Words that match the letters already in the span, or match all but one.
 *
 * The odd one out is a square the play would cover. Dropping each fixed
 * position in turn is what turns "the board says A here" from a requirement
 * into a choice; `fit` then charges a tile for disagreeing, and the legality
 * check has the last word on whether covering it is allowed.
 */
export function withOneCovered(
  index: LengthIndex,
  fixed: [number, string][],
  rackPool: readonly number[],
): number[] {
  const pool = new Set<number>(candidates(index, fixed) ?? []);

  for (let skip = 0; skip < fixed.length; skip++) {
    const rest = fixed.filter((_, i) => i !== skip);
    // Nothing left to match on: the rack decides, exactly as for a span with
    // no letters in it at all.
    // With nothing left to match on, the rack decides — exactly as for a span
    // with no letters in it at all, so the same list serves.
    const found = rest.length > 0 ? candidates(index, rest)! : rackPool;
    for (const i of found) pool.add(i);
  }

  return [...pool];
}

/**
 * Intersection of two ascending lists, into a fresh ascending list.
 *
 * Posting lists are built by pushing `index.words.length` as each word is
 * appended, so they arrive ascending and a linear merge answers the same
 * question a `Set` did — without allocating one per intersection step, which
 * measured at a fifth of the bot search's entire running time.
 */
function meet(a: readonly number[], b: readonly number[]): number[] {
  const out: number[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const x = a[i];
    const y = b[j];
    if (x === y) {
      out.push(x);
      i++;
      j++;
    } else if (x < y) i++;
    else j++;
  }
  return out;
}

export function candidates(index: LengthIndex, fixed: [number, string][]): number[] | null {
  if (fixed.length === 0) return null;

  const lists = fixed.map(([i, ch]) => index.posting.get(`${i}:${ch}`) ?? []);
  // Smallest first, so each merge starts from the shortest list there is and
  // the result only shrinks from there.
  lists.sort((a, b) => a.length - b.length);

  let hits = lists[0]!;
  for (const list of lists.slice(1)) {
    hits = meet(hits, list);
    if (hits.length === 0) break;
  }
  return hits;
}
