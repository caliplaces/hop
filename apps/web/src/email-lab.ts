/**
 * Email lab: a dev-only page for designing Hop's emails with sample data.
 * Open http://localhost:5173/email-lab.html while `pnpm dev` runs.
 *
 * The API renders each email (apps/api/src/email) at /api/dev/emails/:name;
 * this page shows it in a frame at phone or desktop width, in light or dark
 * mode, with the plain-text version and subject alongside.
 */
import { PALETTE } from "@hop/shared";

type Rendered = { subject: string; html: string; text: string };

const root = document.getElementById("lab") as HTMLElement;
document.body.style.cssText = "margin:0;font:14px system-ui;background:#e9e9e4;color:#0b0b0c";

function labelled(label: string, element: HTMLElement) {
  const wrapper = document.createElement("label");
  wrapper.style.cssText = "display:flex;flex-direction:column;gap:4px;font-size:12px";
  wrapper.append(label, element);
  controls.append(wrapper);
}

function select(label: string, options: [value: string, text: string][]): HTMLSelectElement {
  const element = document.createElement("select");
  for (const [value, text] of options) element.add(new Option(text, value));
  labelled(label, element);
  return element;
}

function input(label: string, value: string): HTMLInputElement {
  const element = document.createElement("input");
  element.value = value;
  labelled(label, element);
  return element;
}

const controls = document.createElement("div");
controls.style.cssText = "display:flex;flex-wrap:wrap;gap:12px;padding:16px;align-items:end";
const subject = document.createElement("p");
subject.style.cssText = "margin:0 16px 12px;font-weight:600";
const stage = document.createElement("div");
stage.style.cssText =
  "display:flex;flex-wrap:wrap;gap:16px;padding:0 16px 32px;align-items:flex-start";
const frame = document.createElement("iframe");
frame.title = "Email preview";
frame.style.cssText = "border:0;border-radius:12px;background:#fff;height:1100px";
const text = document.createElement("pre");
text.style.cssText =
  "flex:1;min-width:280px;margin:0;padding:16px;border-radius:12px;background:#fff;white-space:pre-wrap;font:13px/1.5 ui-monospace,monospace";
stage.append(frame, text);
root.append(controls, subject, stage);

const { emails } = (await (await fetch("/api/dev/emails")).json()) as { emails: string[] };
const template = select(
  "Email",
  emails.map((name) => [name, name]),
);
const color = select(
  "Colour",
  PALETTE.map((c) => [c.id, c.name]),
);
const width = select("Width", [
  ["600", "Desktop (600)"],
  ["375", "Phone (375)"],
]);
const scheme = select("Mode", [
  ["light", "Light"],
  ["dark", "Dark (Apple Mail)"],
]);
const name = input("Name", "Matej Matiasko");
const handle = input("Handle", "matej");

async function refresh() {
  const query = new URLSearchParams({ color: color.value, name: name.value, handle: handle.value });
  const response = await fetch(`/api/dev/emails/${template.value}?${query}`);
  const email = (await response.json()) as Rendered;
  subject.textContent = `Subject: ${email.subject}`;
  text.textContent = email.text;
  frame.style.width = `${width.value}px`;
  // An iframe's prefers-color-scheme follows the colour scheme of its element.
  frame.style.colorScheme = scheme.value;
  frame.srcdoc = email.html;
}

for (const element of [template, color, width, scheme, name, handle]) {
  element.addEventListener("input", refresh);
}
await refresh();
