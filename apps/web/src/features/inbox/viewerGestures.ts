/** How far a finger must travel to count as a swipe, in CSS pixels. */
export const SWIPE_PX = 60;
/** Swiping down this far closes the viewer, as in the app. */
export const CLOSE_PX = 110;

export type SwipeAction = "next" | "prev" | "close" | null;

/**
 * What a swipe on the viewer does, from how far the finger moved (`dx` to
 * the right, `dy` downwards). Sideways goes to the next or previous clip;
 * a long pull down closes; anything shorter or diagonal does nothing, so a
 * scrub on the video's own controls isn't mistaken for one.
 */
export function swipeAction(dx: number, dy: number): SwipeAction {
  const across = Math.abs(dx);
  const down = Math.abs(dy);
  if (across >= SWIPE_PX && across > down * 1.2) return dx < 0 ? "next" : "prev";
  if (dy >= CLOSE_PX && down > across * 1.5) return "close";
  return null;
}
