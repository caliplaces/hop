export const canShare = typeof navigator !== "undefined" && "share" in navigator;

/** Native share sheet; a dismissed sheet isn't an error. */
export function shareHop(url: string) {
  return navigator
    .share?.({ title: "Upload it on my Hop", text: "Send me your clips 🙌", url })
    .catch(() => {});
}
