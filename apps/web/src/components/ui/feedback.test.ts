import { describe, expect, it } from "vitest";
import { followToastHost, toastHost } from "./feedback";

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

describe("following where toasts show", () => {
  /** A page whose dialogs open and close, watched by a stand-in MutationObserver. */
  function livePage() {
    const dialogs: FakeDialog[] = [];
    const doc = page(dialogs);
    // page() maps the list once; read it live instead.
    doc.querySelectorAll = (() =>
      dialogs.map((d) => ({ ...d, matches: () => d.modal === true }))) as never;
    const watched: { target: unknown; options: MutationObserverInit }[] = [];
    let notify = () => {};
    let disconnected = false;
    class Observer {
      constructor(callback: () => void) {
        notify = callback;
      }
      observe(target: unknown, options: MutationObserverInit) {
        watched.push({ target, options });
      }
      disconnect() {
        disconnected = true;
      }
    }
    return {
      dialogs,
      doc,
      watched,
      changed: () => notify(),
      disconnected: () => disconnected,
      Observer: Observer as unknown as typeof MutationObserver,
    };
  }

  it("moves a toast to what's below when the dialog it showed in closes", () => {
    const live = livePage();
    live.dialogs.push(
      { name: "viewer", open: true, modal: true },
      { name: "report", open: true, modal: true },
    );
    const hosts: string[] = [];
    const stop = followToastHost(
      (host) => hosts.push((host as unknown as { name: string }).name),
      live.doc,
      live.Observer,
    );
    // Shown as Report closes: its dialog is still open at first.
    expect(hosts).toEqual(["report"]);
    const report = live.dialogs[1];
    if (report) report.open = false;
    live.changed();
    expect(hosts.at(-1)).toBe("viewer");
    const viewer = live.dialogs[0];
    if (viewer) viewer.open = false;
    live.changed();
    expect(hosts.at(-1)).toBe("body");
    stop();
    expect(live.disconnected()).toBe(true);
  });

  it("watches the whole page for dialogs opening, closing, coming and going", () => {
    const live = livePage();
    followToastHost(() => {}, live.doc, live.Observer);
    expect(live.watched).toEqual([
      {
        target: live.doc.body,
        options: { subtree: true, childList: true, attributes: true, attributeFilter: ["open"] },
      },
    ]);
  });
});
