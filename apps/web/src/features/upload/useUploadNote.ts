import { useCallback, useRef, useState } from "react";

/**
 * The sender's optional note for the athlete. Kept for this visit only,
 * unlike their name: it's about these clips. `getNote` is a stable reader
 * for the uploader, which outlives renders.
 */
export function useUploadNote() {
  const [note, setNote] = useState("");
  const ref = useRef(note);
  ref.current = note;
  const getNote = useCallback(() => ref.current.trim() || undefined, []);
  return { note, setNote, getNote };
}
