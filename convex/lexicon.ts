import ALL_WORDS from "../shared/data/words.json" with { type: "json" };
import COMMON_WORDS from "../shared/data/common-words.json" with { type: "json" };
import { makeDictionary } from "../shared/engine/dictionary.js";
import { indexWords } from "../shared/sim/bot.js";
import type { Lexicon, Vocabulary } from "../shared/sim/levels.js";

/**
 * Built on first use, not when the module loads, and kept for the life of
 * the isolate. Keyed by vocabulary and nothing else: it is the same for every
 * game and every player, and never changes once built, so concurrent bot
 * turns and hints share it safely.
 *
 * Every function in a deployment shares the module graph, so work done at the
 * top level here is work the sign-in query pays for too — on every cold
 * isolate, in a game with no machines in it at all. Indexing the dictionary
 * is a cost that should be charged to whoever uses it.
 */
const built: Partial<Record<Vocabulary, Lexicon>> = {};

/**
 * A dictionary to check words against and an index to search, from one list.
 *
 * Only words up to seven letters are indexed, seven being the most tiles a
 * turn can lay: a rack holds seven. A longer word is not out of reach in
 * principle -- it would run through letters already standing -- but those
 * lengths were cut when a turn had a second to finish in, and that reason has
 * gone with the rest. It is another thing to measure rather than another
 * thing to keep. Crossing words are checked against the whole of the
 * level's list, so nothing the bot plays is limited to seven letters; only
 * what it looks for is.
 *
 * One pair per vocabulary (shared/sim/levels.ts), and the dictionary is the
 * level's list too, not the game's: an easy bot checking its crossing words
 * against every word in the game would still build squares out of words it
 * was never meant to know.
 */
export function lexicon(vocabulary: Vocabulary): Lexicon {
  const list = vocabulary === "full" ? ALL_WORDS : COMMON_WORDS;
  built[vocabulary] ??= {
    dictionary: makeDictionary(list),
    words: indexWords(list.filter((word) => word.length <= 7), 7),
  };
  return built[vocabulary];
}
