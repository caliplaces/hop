/**
 * Which clip the viewer shows once some leave the list (deleted, or with a
 * blocked sender): the next one still there, else the previous one, else
 * none. The one on show stays if it isn't among them.
 */
export function viewingAfter(
  ids: string[],
  current: string,
  removed: ReadonlySet<string>,
): string | null {
  if (!removed.has(current)) return current;
  const at = ids.indexOf(current);
  if (at < 0) return null;
  for (let i = at + 1; i < ids.length; i++) {
    const id = ids[i] as string;
    if (!removed.has(id)) return id;
  }
  for (let i = at - 1; i >= 0; i--) {
    const id = ids[i] as string;
    if (!removed.has(id)) return id;
  }
  return null;
}
