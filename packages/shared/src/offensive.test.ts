import { describe, expect, it } from "vitest";
import { checkHandle } from "./handles";
import { isOffensive } from "./offensive";

const offensive = (names: string[]) => names.filter((name) => !isOffensive(name));
const innocent = (names: string[]) => names.filter((name) => isOffensive(name));

describe("offensive names", () => {
  it("catches slurs, sexual and profane words, inside other words too", () => {
    expect(
      offensive([
        "fuck",
        "fuckyou",
        "motherfucker",
        "shithead",
        "bullshit",
        "cunt",
        "bitch",
        "pornstar",
        "milfhunter",
        "nigger",
        "niggas",
        "faggot",
        "retarded",
        "therapist.rapist",
        // Read together it's "therapist", which is innocent: each part counts too.
        "the.rapist",
        "heilhitler",
        "kkk",
        "kurva",
        "kokot",
        "zmrd",
      ]),
    ).toEqual([]);
  });

  it("catches words that hide in innocent ones only on their own", () => {
    expect(
      offensive(["ass", "big_ass", "asses", "cock.rider", "dick", "dicks", "sex", "anal", "nazi"]),
    ).toEqual([]);
    expect(offensive(["paki", "spic", "rape", "tits", "cum", "pica", "negr", "cikan"])).toEqual([]);
  });

  it("sees through leetspeak, accents, separators and stretched letters", () => {
    expect(
      offensive([
        "sh1t",
        "5hit",
        "$hit",
        "s1ut",
        "n1gg3r",
        "f4gg0t",
        "p0rn",
        "c0ck",
        "b00bs",
        "k0k0t",
        "f.u.c.k",
        "f_u_c_k",
        "f-u-c-k",
        "f u c k",
        "fuuuuuck",
        "shiiiiit",
        "píča",
        "Čurák",
        "FUCK",
        // Each "1" reads as "i" or "l" on its own.
        "h1t1er",
        "h1tl3r",
        "5h1t",
      ]),
    ).toEqual([]);
  });

  it("only lets an innocent word excuse what lies inside it", () => {
    // "shita" is in Yamashita, but nothing innocent surrounds this "shit".
    expect(offensive(["shitass", "fukyou", "scunthorpecunt", "therapist_rapist"])).toEqual([]);
    expect(innocent(["yamashita", "fukuoka", "fukushima", "shiitake", "yoshito"])).toEqual([]);
  });

  it("catches hate numbers", () => {
    expect(isOffensive("aryan1488")).toBe(true);
  });

  it("leaves innocent words alone: the Scunthorpe problem", () => {
    expect(
      innocent([
        "scunthorpe",
        "classic",
        "assassin",
        "therapist",
        "cockburn",
        "dickson",
        "sussex",
        "shitake",
        "analyst",
        "grapeape",
        "bassline",
        "glasshouse",
        "massimo",
        "peacock",
        "hancock",
        "cocktail",
        "dickens",
        "essex",
        "sextant",
        "canal",
        "banal",
        "uranus",
        "janus",
        "drape",
        "scraper",
        "title",
        "titan",
        "petition",
        "cucumber",
        "document",
        "accumulate",
        "spice",
        "conspicuous",
        "pakistan",
        "nazir",
        "raccoon",
        "tycoon",
        "cocoon",
        "prickly",
        "swank",
        "homer",
        "homogenous",
        "picasso",
        "negroni",
        "niger",
        "nigeria",
        "niggle",
        "penistone",
        "milford",
        "lesbos",
        "fukuoka",
        "yamashita",
        "kinoshita",
        "yoshitaka",
        "kundalini",
        "kundan",
      ]),
    ).toEqual([]);
  });

  it("leaves athletes' handles alone", () => {
    expect(
      innocent([
        "alex.rider",
        "maty",
        "skatelife",
        "sk8erboi",
        "jumprope_kid",
        "calisthenics.cz",
        "mountain_bike",
        "parkour.prague",
        "sassy.sam",
        "crushit",
        "smashit",
        "pushit_harder",
        "finishit",
        "bmx.legend",
        "climb_2026",
        "a1ex",
        "run4fun",
      ]),
    ).toEqual([]);
  });

  it("checks event names with spaces and punctuation", () => {
    expect(isOffensive("Worlds 2026")).toBe(false);
    expect(isOffensive("Sussex Open")).toBe(false);
    expect(isOffensive("Big Ass Jam")).toBe(true);
    expect(isOffensive("Fuck yeah")).toBe(true);
  });

  it("stops handles from being claimed, without saying why", () => {
    expect(checkHandle("big_ass")).toBe("unavailable");
    expect(checkHandle("sh1t.happens")).toBe("unavailable");
    expect(checkHandle("classic.rider")).toBeNull();
    // The other rules come first.
    expect(checkHandle("admin")).toBe("reserved");
    expect(checkHandle("f")).toBe("invalid");
  });
});
