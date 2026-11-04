import type { Placement } from "../../shared/engine/score";

/** One recorded turn: who played, what it scored, the words it made, the tiles. */
export interface ScriptTurn {
  seat: 0 | 1 | 2;
  score: number;
  words: readonly string[];
  placements: readonly Placement[];
}

/** The seat the learner plays. */
export const PLAYER_SEAT = 1;
export const SEAT_NAMES: readonly [string, string, string] = ["Isolde", "You", "Rostam"];
export const LAYOUT = "Open";
export const BOARD_SIZE = 15;
export const BAG_SIZE = 99;
export const RACK_SIZE = 7;

/** A recorded game: prod game j57933av51r6sst9bd49djkhc98ffafq (seat 0 Clintron, 1 BenDBeatz, 2 Ugona). */
interface RawTurn {
  seat: 0 | 1 | 2;
  score: number;
  words: readonly string[];
  /** `x,y,L` per tile; a lowercase letter is a blank standing for that letter. */
  tiles: string;
}

const RAW: readonly RawTurn[] = [
  { seat: 0, score: 15, words: ["UP", "CUT", "PIC", "TA"], tiles: "7,6,P 7,7,I 7,8,C 6,6,U 8,8,U 9,8,T 9,9,A" },
  { seat: 1, score: 53, words: ["ANA", "NITS", "PICA", "TUN", "STAB", "UN"], tiles: "7,9,A 8,7,T 8,9,N 9,7,s 6,7,N 9,10,B" },
  { seat: 2, score: 28, words: ["KNAVE", "HIP", "PICK", "EMO", "IN"], tiles: "7,9,K 10,9,V 11,9,E 11,10,M 11,11,O 5,6,H 6,6,I" },
  { seat: 0, score: 75, words: ["SET", "CUB", "PICKS", "TUNER", "HUH", "BIN", "STAT"], tiles: "7,10,S 8,11,R 8,10,e 5,4,H 5,5,U 4,5,C 6,5,B 9,10,T" },
  { seat: 1, score: 40, words: ["MOB", "GEM", "BIOME"], tiles: "13,10,B 13,12,O 13,11,I 13,13,M 13,14,E 12,10,o 11,13,G 12,13,E" },
  { seat: 2, score: 77, words: ["SNITS", "BIN", "CUBS", "MOP", "AI", "HUBS", "SNICKS", "PRIME", "AE"], tiles: "5,7,S 5,6,B 7,6,N 7,5,s 13,10,P 13,11,R 13,12,I 12,12,A" },
  { seat: 0, score: 32, words: ["LACE", "BUBS", "MOPE", "CHUBS", "YE"], tiles: "5,3,C 3,3,L 4,3,A 6,3,E 4,5,B 14,10,E 14,9,Y" },
  { seat: 1, score: 31, words: ["DOGS", "LACEY", "GAL", "LO"], tiles: "3,1,G 3,2,A 2,1,O 1,1,D 4,1,S 2,0,L 7,3,Y" },
  { seat: 2, score: 22, words: ["PRY", "DRILL", "EYE"], tiles: "7,1,P 7,2,R 1,4,L 1,5,L 1,3,I 1,2,R 14,8,E" },
  { seat: 0, score: 105, words: ["DE", "EN", "REFORMED"], tiles: "13,8,D 13,7,E 13,3,F 13,4,O 13,5,R 13,6,M 13,1,r 13,2,e 14,14,N" },
  { seat: 1, score: 43, words: ["OS", "AN", "DRAGONS", "PRIMA", "MEMO"], tiles: "1,4,G 1,5,O 1,6,N 1,7,s 13,14,A 11,8,M 0,7,O 1,3,A" },
  { seat: 2, score: 71, words: ["TOT", "ONE", "OSE", "RE", "OM", "TOO", "TEE", "REFORMER", "TUNERS"], tiles: "0,5,T 2,5,T 2,6,E 0,6,o 2,7,E 13,8,R 8,12,S 14,4,M" },
  { seat: 0, score: 37, words: ["BUDS", "PACEY", "PI", "IF", "HE", "DIN", "GAP", "DEFORMER", "PE", "HI", "TEES"], tiles: "6,5,D 3,3,P 13,1,D 12,12,P 12,3,I 12,2,H 2,8,S" },
  { seat: 1, score: 64, words: ["WIFE", "AHEM", "DOM", "AW", "MEM", "HID"], tiles: "11,3,W 14,3,E 14,2,M 12,4,D 11,2,A" },
  { seat: 2, score: 15, words: ["RE", "DIGS", "MEME", "PAY", "LI"], tiles: "14,5,E 7,2,A 2,1,I" },
  { seat: 1, score: 8, words: ["OS", "OD"], tiles: "7,12,O 7,13,D" },
  { seat: 2, score: 40, words: ["ERE", "HIDE"], tiles: "12,5,e" },
];

function parseTiles(tiles: string): Placement[] {
  return tiles.split(" ").map((t) => {
    const [x, y, l] = t.split(",");
    return {
      x: Number(x),
      y: Number(y),
      letter: l.toUpperCase(),
      isBlank: l !== l.toUpperCase(),
    };
  });
}

export const SCRIPT: readonly ScriptTurn[] = RAW.map((r) => ({
  seat: r.seat,
  score: r.score,
  words: r.words,
  placements: parseTiles(r.tiles),
}));
