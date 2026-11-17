import { describe, expect, it } from "vitest";
import { CLOSE_PX, SWIPE_PX, swipeAction } from "./viewerGestures";

describe("a swipe on the viewer", () => {
  it("goes to the next clip leftwards, the previous one rightwards", () => {
    expect(swipeAction(-SWIPE_PX, 0)).toBe("next");
    expect(swipeAction(SWIPE_PX + 40, 10)).toBe("prev");
  });

  it("closes when pulled down far enough", () => {
    expect(swipeAction(0, CLOSE_PX)).toBe("close");
    expect(swipeAction(20, CLOSE_PX + 50)).toBe("close");
  });

  it("does nothing when short, upwards or diagonal", () => {
    expect(swipeAction(-(SWIPE_PX - 1), 0)).toBeNull();
    expect(swipeAction(0, CLOSE_PX - 1)).toBeNull();
    expect(swipeAction(0, -CLOSE_PX * 2)).toBeNull();
    expect(swipeAction(-80, 80)).toBeNull();
    expect(swipeAction(90, CLOSE_PX + 10)).toBeNull();
  });
});
