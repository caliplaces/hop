import { cleanName, UPLOAD_NOTE_MAX } from "@hop/shared";
import { useCallback, useRef, useState } from "react";

/**
 * How long the note is once the server has cleaned it (cleanName). That can
 * be longer than what was typed: "½" becomes "1⁄2". The field counts this.
 */
export function noteLength(note: string): number {
  return cleanName(note).length;
}

/**
 * The note as it's sent: cleaned as the server will clean it, and cut to
 * fit if cleaning made it too long, so a note can never stop an upload.
 * The field says when that happens. Nothing for a blank note.
 */
export function fitNote(note: string): string | undefined {
  const cleaned = cleanName(note);
  if (cleaned.length <= UPLOAD_NOTE_MAX) return cleaned || undefined;
  let fitted = "";
  // Whole characters only, never half of an emoji.
  for (const char of cleaned) {
    if (fitted.length + char.length > UPLOAD_NOTE_MAX) break;
    fitted += char;
  }
  return cleanName(fitted) || undefined;
}

/**
 * The sender's optional note for the athlete. Kept for this visit only,
 * unlike their name: it's about these clips. `getNote` is a stable reader
 * for the uploader, which outlives renders.
 */
export function useUploadNote() {
  const [note, setNote] = useState("");
  const ref = useRef(note);
  ref.current = note;
  const getNote = useCallback(() => fitNote(ref.current), []);
  return { note, setNote, getNote };
}
