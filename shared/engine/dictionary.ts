import type { Dictionary } from "./legality.js";

/** Case-insensitive word lookup over a fixed list. */
export function makeDictionary(words: Iterable<string>): Dictionary {
  const set = new Set<string>();
  for (const word of words) set.add(word.toUpperCase());

  return { has: (word) => set.has(word.toUpperCase()) };
}
