import { describe, expect, it } from "vitest";
import { toastHost } from "./feedback";

type FakeDialog = { open: boolean; modal: boolean | "unknown"; name: string };

function page(dialogs: FakeDialog[]) {
  const body = { name: "body" };
  const elements = dialogs.map((d) => ({
    ...d,
    matches: (selector: string) => {
      if (selector !== ":modal") throw new Error(selector);
      if (d.modal === "unknown") throw new SyntaxError("unsupported");
      return d.modal;
    },
  }));
  return { body, querySelectorAll: () => elements } as unknown as Document;
}

const host = (dialogs: FakeDialog[]) =>
  (toastHost(page(dialogs)) as unknown as { name: string }).name;

describe("where toasts show", () => {
  it("is the page when no modal is open", () => {
    expect(host([])).toBe("body");
    expect(host([{ name: "closed", open: false, modal: false }])).toBe("body");
    // An open dialog that isn't modal doesn't cover the page.
    expect(host([{ name: "inline", open: true, modal: false }])).toBe("body");
  });

  it("is the topmost open modal, such as the viewer or a dialog over it", () => {
    expect(host([{ name: "viewer", open: true, modal: true }])).toBe("viewer");
    expect(
      host([
        { name: "viewer", open: true, modal: true },
        { name: "report", open: true, modal: true },
      ]),
    ).toBe("report");
    expect(
      host([
        { name: "viewer", open: true, modal: true },
        { name: "report", open: false, modal: false },
      ]),
    ).toBe("viewer");
  });

  it("treats an open dialog as modal where the browser can't say", () => {
    expect(host([{ name: "old", open: true, modal: "unknown" }])).toBe("old");
  });
});
