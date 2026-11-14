import { randomContributorName } from "@hop/shared";
import { useCallback, useRef, useState } from "react";

const STORAGE_KEY = "hop:contributorName";

function initialName(): string {
  try {
    const existing = localStorage.getItem(STORAGE_KEY);
    if (existing) return existing;
    const generated = randomContributorName();
    localStorage.setItem(STORAGE_KEY, generated);
    return generated;
  } catch {
    return randomContributorName();
  }
}

/**
 * The anonymous contributor's display name: a friendly random default
 * ("SmokyMonkey441"), editable and remembered on this device. `getName` is a
 * stable reader for the uploader, which outlives renders.
 */
export function useContributorName() {
  const [name, setNameState] = useState(initialName);
  const ref = useRef(name);
  ref.current = name;

  const setName = useCallback((value: string) => {
    setNameState(value);
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch {}
  }, []);
  const getName = useCallback(() => ref.current.trim() || undefined, []);

  return { name, setName, getName };
}
