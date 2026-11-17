/**
 * Words that public names can't contain: slurs, and sexual or profane words.
 * Handles (onmyhop.com/<handle>), event links (onmyhop.com/<handle>/<link>)
 * and event names are public, so each is checked with isOffensive.
 *
 * Matching is deliberately simple and predictable:
 * - Case and accents don't count ("Píča" is "pica").
 * - Digits and symbols stand in for letters as in leetspeak (0 o, 1 i or l,
 *   each "1" on its own, 3 e, 4 a, 5 s, 7 t, 8 b, 9 g, $ s, @ a, ! i).
 * - Letters may repeat ("fuuuck"), but a word's own double letters must be
 *   there: "niger" (the river, the country) isn't the slur.
 * - "_" and "." don't separate letters ("f.u.c.k"), and letters spelled out
 *   one by one between other separators are read together ("f-u-c-k").
 *
 * ANYWHERE words count inside other words too ("pornstar"). WHOLE words only
 * count on their own, since they hide inside innocent ones: "classic",
 * "cockburn", "sussex", "analyst", "grapeape". ALLOWED lists innocent words
 * that contain an ANYWHERE word ("scunthorpe", "therapist"). Each excuses
 * only what lies wholly inside it: "yamashita" is fine, but "shitass" has no
 * innocent word around its "shit".
 *
 * So "big_ass" is caught but "bigass" isn't: some words can't be caught
 * inside others without catching innocent names too. Reports cover what this
 * misses.
 */

/** Count inside other words: nothing innocent contains them (but ALLOWED). */
const ANYWHERE = [
  // Slurs.
  "nigger",
  "nigga",
  "faggot",
  "fagot",
  "tranny",
  "shemale",
  "retard",
  "wetback",
  "raghead",
  "towelhead",
  "beaner",
  "jigaboo",
  "porchmonkey",
  "lesbo",
  "kkk",
  "hitler",
  "rapist",
  // Sexual.
  "porn",
  "pussy",
  "penis",
  "vagina",
  "dildo",
  "blowjob",
  "handjob",
  "rimjob",
  "cumshot",
  "jizz",
  "milf",
  "boobs",
  "boobies",
  "orgasm",
  "hentai",
  "cocksucker",
  "titties",
  "whore",
  "slut",
  // Profane.
  "fuck",
  "fuk",
  "fck",
  "shit",
  "cunt",
  "bitch",
  "bastard",
  "asshole",
  "dumbass",
  "jackass",
  "dickhead",
  "wanker",
  "twat",
  "bollocks",
  // Czech and Slovak.
  "kurva",
  "kokot",
  "zmrd",
  "curak",
  "jebat",
  "jebem",
  "buzerant",
  "mrdat",
];

/** Count only on their own (or with a plural "s"), as innocent words contain them. */
const WHOLE = [
  "ass",
  "arse",
  "cock",
  "dick",
  "cum",
  "tit",
  "anal",
  "anus",
  "sex",
  "rape",
  "piss",
  "prick",
  "orgy",
  "wank",
  "nazi",
  "fag",
  "dyke",
  "spic",
  "chink",
  "kike",
  "coon",
  "gook",
  "paki",
  "homo",
  // Czech and Slovak.
  "pica",
  "pici",
  "negr",
  "cikan",
  "cigan",
  "buzna",
  "kunda",
];

/**
 * Innocent words that contain an ANYWHERE word. Each excuses only what lies
 * wholly inside it, so they're whole words and names, not fragments.
 */
const ALLOWED = [
  "scunthorpe",
  "therapist",
  // Japanese names.
  "yamashita",
  "kinoshita",
  "morishita",
  "matsushita",
  "kishita",
  "oshita",
  "yoshitaka",
  "yoshitake",
  "yoshitomo",
  "yoshito",
  "toshitaka",
  "fukuoka",
  "fukuda",
  "fukui",
  "fukushima",
  "fukuyama",
  "fukuzawa",
  "fukumoto",
  "fukunaga",
  "shitake",
  "shiitake",
  "shitzu",
  "crushit",
  "smashit",
  "pushit",
  "finishit",
  "washit",
  "brushit",
  "mishit",
  "penistone",
  "penisola",
  "milford",
  "retardant",
  "lesbos",
];

/** Numbers that stand for hate on their own: they're matched as typed. */
const NUMBERS = ["1488"];

const LEET: Record<string, string> = {
  "0": "o",
  "3": "e",
  "4": "a",
  "5": "s",
  "7": "t",
  "8": "b",
  "9": "g",
  $: "s",
  "@": "a",
  "!": "i",
};

/** A letter as a pattern: "1" reads as "i" or "l", each one on its own ("h1t1er"). */
const letter = (c: string) => (c === "i" ? "[i1]" : c === "l" ? "[l1]" : c);

/** A word's letters, each allowed to repeat: "nigger" is n+i+g{2,}e+r+. */
function lenient(word: string): string {
  return word.replace(/(.)\1*/g, (run, c: string) =>
    run.length === 1 ? `${letter(c)}+` : `${letter(c)}{${run.length},}`,
  );
}

const anywhere = ANYWHERE.map((word) => new RegExp(lenient(word), "g"));
const whole = new RegExp(`^(?:${WHOLE.map(lenient).join("|")})(?:e?s)?$`);
const allowed = ALLOWED.map((word) => new RegExp([...word].map(letter).join(""), "g"));

/** Where each match of `patterns` is in `text`, as [start, end) pairs. */
function spans(patterns: RegExp[], text: string): [number, number][] {
  return patterns.flatMap((pattern) =>
    [...text.matchAll(pattern)].map((m): [number, number] => [m.index, m.index + m[0].length]),
  );
}

/** Whether `text` has an ANYWHERE word that no innocent word around it excuses. */
function hasAnywhereWord(text: string): boolean {
  const excused = spans(allowed, text);
  return spans(anywhere, text).some(
    ([start, end]) => !excused.some(([from, to]) => from <= start && end <= to),
  );
}

/** The input as letters, "1" kept as itself: it reads as "i" or "l" (see letter). */
function reading(input: string): string {
  return input
    .slice(0, 200)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[0345789$@!]/g, (c) => LEET[c] ?? c);
}

/**
 * The words to check: split at anything but letters, "1", "_" and "."
 * (spaces, "-", other digits left over), plus runs of single letters read
 * together.
 */
function words(reading: string): string[] {
  const found = reading.split(/[^a-z1._]+/).filter(Boolean);
  const spelled: string[] = [];
  let run = "";
  for (const word of [...found, ""]) {
    if (word.replace(/[._]/g, "").length === 1) {
      run += word;
      continue;
    }
    if (run.length > 1) spelled.push(run);
    run = "";
  }
  return [...found, ...spelled];
}

function wordIsOffensive(word: string): boolean {
  const parts = word.split(/[._]+/).filter(Boolean);
  const joined = parts.join("");
  if (parts.some((part) => whole.test(part)) || whole.test(joined)) return true;
  return [...parts, joined].some(hasAnywhereWord);
}

/** Whether a public name (a handle, an event's link or name) has a word Hop doesn't allow. */
export function isOffensive(input: string): boolean {
  if (NUMBERS.some((number) => input.includes(number))) return true;
  return words(reading(input)).some(wordIsOffensive);
}
