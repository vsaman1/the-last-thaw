/**
 * The student's two plain-English rules (playtest, 2026-10-23), as patterns shared by the authored-text
 * tests (src/story/chapters/chapters.test.ts) and the deterministic validator of the agents' text
 * (src/story/validate.ts): people by their full names, never a bare initial ("E. is driving the late
 * train"), and plain modern words, not regional or old-fashioned ones a reader needs explained
 * ("Spoilt: 9", "by the font").
 */

/**
 * A capital letter and a full stop standing for a name: "E. is", "A. Sorel", "T.L.", "(M.)", "Love, T.".
 * Labels that end in a letter ("Annex F.", "Route A", "Point B", "Coach B") are not names.
 */
export const INITIAL =
  /(?<![\p{L}\p{N}.])(?<!\b(?:Annex|Route|Option|Point|Coach|Item|Line|Gauge|Stake|Tank|Rig|Plan) )\p{Lu}\.(?:\s?\p{Lu}\.)*(?![\p{L}\p{N}])/u;

/**
 * The words the playtest stumbled on, and their neighbours from the same drafts. Ids may keep them
 * ('bothy', 'clachan-kirk', 'ch8-larder-door'): only what the player reads is checked.
 */
export const GLOSSED = /\b(?:spoilt|biro|font|bothy|bund|kirk|larder|cirque|knoll|teatime|moraine|budgie|fank|braes?)\b/i;

/**
 * The bare initials in a text, in order. "I." at the end of a sentence ("and so did I.") is the pronoun,
 * not an initial.
 */
export function bareInitials(text: string): string[] {
  const all = new RegExp(INITIAL.source, 'gu');
  return [...text.matchAll(all)].map((m) => m[0]).filter((m) => m !== 'I.');
}

/** The words in a text that need explaining, in order. */
export function glossedWords(text: string): string[] {
  return [...text.matchAll(new RegExp(GLOSSED.source, 'gi'))].map((m) => m[0]);
}
