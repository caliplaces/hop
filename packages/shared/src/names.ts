const ADJECTIVES = [
  "Smoky",
  "Swift",
  "Brave",
  "Mighty",
  "Sneaky",
  "Fuzzy",
  "Jumpy",
  "Lucky",
  "Sunny",
  "Bold",
  "Clever",
  "Wild",
  "Chill",
  "Turbo",
  "Cosmic",
  "Spicy",
  "Golden",
  "Silent",
  "Bouncy",
  "Steady",
  "Rapid",
  "Funky",
  "Electric",
  "Frosty",
  "Groovy",
  "Happy",
  "Iron",
  "Jolly",
  "Nimble",
  "Rocket",
];

const ANIMALS = [
  "Monkey",
  "Panda",
  "Tiger",
  "Otter",
  "Falcon",
  "Gecko",
  "Badger",
  "Koala",
  "Lynx",
  "Moose",
  "Narwhal",
  "Owl",
  "Puffin",
  "Raccoon",
  "Shark",
  "Sloth",
  "Wombat",
  "Yak",
  "Zebra",
  "Fox",
  "Hawk",
  "Bison",
  "Lemur",
  "Llama",
  "Mantis",
  "Orca",
  "Pigeon",
  "Rhino",
  "Squid",
  "Walrus",
];

function pick<T>(items: readonly T[], random: () => number): T {
  return items[Math.floor(random() * items.length)] as T;
}

/** A friendly default contributor name like "SmokyMonkey441". */
export function randomContributorName(random: () => number = Math.random): string {
  const number = 100 + Math.floor(random() * 900);
  return `${pick(ADJECTIVES, random)}${pick(ANIMALS, random)}${number}`;
}
