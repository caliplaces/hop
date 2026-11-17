/**
 * Words that public names can't contain: slurs, and sexual or profane words.
 * Handles (onmyhop.com/<handle>), event links (onmyhop.com/<handle>/<link>)
 * and event names are public, so each is checked with isOffensive.
 *
 * Matching is deliberately simple and predictable:
 * - Case and accents don't count ("Píča" is "pica").
 * - Digits and symbols stand in for letters as in leetspeak (0 o, 1 i or l,
 *   3 e, 4 a, 5 s, 7 t, 8 b, 9 g, $ s, @ a, ! i).
 * - Letters may repeat ("fuuuck"), but a word's own double letters must be
 *   there: "niger" (the river, the country) isn't the slur.
 * - "_" and "." don't separate letters ("f.u.c.k"), and letters spelled out
 *   one by one between other separators are read together ("f-u-c-k").
 *
 * ANYWHERE words count inside other words too ("pornstar"). WHOLE words only
 * count on their own, since they hide inside innocent ones: "classic",
 * "cockburn", "sussex", "analyst", "grapeape". ALLOWED lists innocent words
 * that contain an ANYWHERE word ("scunthorpe", "therapist"), which are set
 * aside first. So "big_ass" is caught but "bigass" isn't: some words can't be
 * caught inside others without catching innocent names too. Reports cover
 * what this misses.
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

/** Innocent words that contain an ANYWHERE word, set aside before matching. */
const ALLOWED = [
  "scunthorpe",
  "therapist",
  // Japanese names: Yamashita, Kinoshita, Yoshitaka; Fukuoka, Fukuda.
  "shita",
  "fuku",
  "shitake",
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

/** A word's letters, each allowed to repeat: "nigger" is n+i+g{2,}e+r+. */
function lenient(word: string): string {
  return word.replace(/(.)\1*/g, (run, letter: string) =>
    run.length === 1 ? `${letter}+` : `${letter}{${run.length},}`,
  );
}

const anywhere = new RegExp(ANYWHERE.map(lenient).join("|"));
const whole = new RegExp(`^(?:${WHOLE.map(lenient).join("|")})(?:e?s)?$`);
const allowed = new RegExp(ALLOWED.join("|"), "g");

/** The input as letters, the two ways "1" reads ("i" and "l"). */
function readings(input: string): string[] {
  const plain = input
    .slice(0, 200)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[0345789$@!]/g, (c) => LEET[c] ?? c);
  return [plain.replace(/1/g, "i"), plain.replace(/1/g, "l")];
}

/**
 * The words to check: split at anything but letters, "_" and "." (spaces,
 * "-", digits left over), plus runs of single letters read together.
 */
function words(reading: string): string[] {
  const found = reading.split(/[^a-z._]+/).filter(Boolean);
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
  // Innocent words go first, so "scunthorpe" isn't read as what it contains.
  return [...parts, joined].some((text) => anywhere.test(text.replace(allowed, "|")));
}

/** Whether a public name (a handle, an event's link or name) has a word Hop doesn't allow. */
export function isOffensive(input: string): boolean {
  if (NUMBERS.some((number) => input.includes(number))) return true;
  return readings(input).some((reading) => words(reading).some(wordIsOffensive));
}
