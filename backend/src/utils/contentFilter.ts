/**
 * Lightweight objectionable-content filter for user-generated free text
 * (display names, plan titles). App Store Guideline 1.2 requires filtering;
 * this is a pragmatic word-list gate, not a moderation system — reports and
 * blocking (Report model, /users/:id/block) cover what a list can't.
 *
 * Matching is case-insensitive on word boundaries after leetspeak
 * normalization, so "Sh1t", "s h i t" won't slip through as standalone words,
 * while legitimate substrings ("Scunthorpe", "assistant") pass.
 */

const BLOCKLIST = [
  'fuck', 'fucker', 'fucking', 'motherfucker',
  'shit', 'bullshit', 'shithead',
  'bitch', 'bitches',
  'cunt', 'twat', 'wanker',
  'asshole', 'arsehole', 'dickhead',
  'cock', 'pussy', 'dildo',
  'nigger', 'nigga', 'faggot', 'fag', 'tranny', 'retard', 'spic', 'kike', 'chink', 'wetback',
  'rape', 'rapist',
  'nazi', 'hitler',
];

const LEET_MAP: Record<string, string> = {
  '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b',
  '@': 'a', '$': 's', '!': 'i', '+': 't',
};

function normalize(text: string): string {
  let out = text.toLowerCase();
  out = out.replace(/[0134578@$!+]/g, (c) => LEET_MAP[c] ?? c);
  // Collapse separators used to disguise words ("s.h.i.t", "s h i t")
  const collapsed = out.replace(/[\s._\-*]+/g, '');
  return `${out} ${collapsed}`;
}

/**
 * Returns the first blocked word found, or null when the text is clean.
 */
export function findObjectionable(text: string | undefined | null): string | null {
  if (!text) return null;
  const normalized = normalize(text);
  for (const word of BLOCKLIST) {
    const re = new RegExp(`(^|[^a-z])${word}($|[^a-z])`, 'i');
    if (re.test(normalized)) return word;
  }
  return null;
}

export function isClean(text: string | undefined | null): boolean {
  return findObjectionable(text) === null;
}
