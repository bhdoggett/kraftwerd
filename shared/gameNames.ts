/**
 * Human-friendly game names, so a lobby of games is distinguishable at a
 * glance without anyone having to name them.
 */
const ADJECTIVES = [
  "Adamant", "Bashful", "Brisk", "Cunning", "Dapper", "Drowsy", "Eager",
  "Feral", "Fussy", "Gallant", "Grumpy", "Hasty", "Jolly", "Lofty", "Lucid",
  "Mellow", "Nimble", "Peckish", "Plucky", "Prickly", "Quiet", "Restless",
  "Rowdy", "Scrappy", "Smug", "Solemn", "Spry", "Stoic", "Sullen", "Tidy",
  "Unruly", "Wary", "Whimsical", "Wistful", "Zealous",
];

const NOUNS = [
  "Aardvark", "Badger", "Beetle", "Bishop", "Cactus", "Cormorant", "Dumpling",
  "Ferret", "Gannet", "Gherkin", "Gopher", "Heron", "Kestrel", "Lantern",
  "Lemur", "Magpie", "Marmot", "Mongoose", "Newt", "Otter", "Parsnip",
  "Pelican", "Puffin", "Quail", "Radish", "Sardine", "Scholar", "Sparrow",
  "Tapir", "Thistle", "Turnip", "Vole", "Walrus", "Wombat", "Yak",
];

/** `random` returns a float in [0, 1); injected so this is testable. */
export function gameName(random: () => number): string {
  const adjective = ADJECTIVES[Math.floor(random() * ADJECTIVES.length)]!;
  const noun = NOUNS[Math.floor(random() * NOUNS.length)]!;
  return `${adjective} ${noun}`;
}
