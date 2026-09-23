/**
 * What changed in each rules version, in the words a player reads.
 *
 * Anyone whose `rulesSeen` is behind RULES_VERSION is shown every entry newer
 * than it, once, the next time the app loads. A version bump that players
 * would not notice -- a dictionary rebuild, say -- still needs an entry, even
 * a short one: changes.test.ts holds this list to the current version, so
 * a bump cannot go out without somebody deciding what to tell people.
 */
export interface RuleChange {
  version: number;
  changes: string[];
}

export const RULE_CHANGES: readonly RuleChange[] = [
  {
    version: 10,
    changes: [
      "No more bonus for stacking. A tile laid on top of another scores the words it makes, and nothing extra.",
      "No more bonus for clearing your rack. Playing every letter scores what its words and squares score.",
      "The +5 for a word of five letters or more now needs the word to be new or longer. Swapping a letter inside a long word already on the board doesn't earn it.",
      "Still paying: a point a letter, +33 for a 3×3, +5 for a long word, and double-word squares.",
      "Records start over, since old scores were set with the bonuses.",
    ],
  },
];

/** The entries a player who has seen up to `seen` has not been told about. */
export function changesSince(seen: number): RuleChange[] {
  return RULE_CHANGES.filter((entry) => entry.version > seen);
}
