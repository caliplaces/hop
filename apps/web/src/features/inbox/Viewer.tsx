import type { InboxFile } from "@hop/shared";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Ellipsis,
  Flag,
  Hand,
  Info,
  Trash2,
  X,
} from "lucide-react";
import {
  type KeyboardEvent,
  type ReactNode,
  type TouchEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { cx } from "../../components/ui/cx";
import { useFeedback } from "../../components/ui/feedback";
import { useModalDialog } from "../../components/ui/useModalDialog";
import { fileUrl } from "../../lib/download";
import { formatBytes, formatDate, relativeTime } from "../../lib/format";
import { ContributorLabel } from "./ContributorLabel";
import { blockProblem, ReportClipDialog } from "./ReportClipDialog";
import { useModeration } from "./useModeration";
import { swipeAction } from "./viewerGestures";

const URL_STALE_MS = 10 * 60_000; // signed URLs live 15 minutes

/** The app's glass, on the viewer's black: a light frost with white text. */
const glass =
  "border border-white/15 bg-white/10 text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.12)] backdrop-blur-xl backdrop-saturate-150";
// Layout classes (display, position) are added per use, never baked in here.
const roundButton = `items-center justify-center rounded-full ${glass} size-11 transition hover:bg-white/20 active:scale-95 disabled:opacity-30`;
const pillButton = `inline-flex h-11 items-center justify-center gap-2 rounded-full px-4 text-sm font-semibold ${glass} transition hover:bg-white/20 active:scale-[0.97] aria-pressed:bg-white/25`;

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <dt className="shrink-0 text-white/60">{label}</dt>
      <dd className="min-w-0 truncate text-right font-medium">{children}</dd>
    </div>
  );
}

/**
 * Full-screen viewer on a native modal <dialog> (focus trap, Esc, inert
 * page), as the app's: who sent it and when up top with where it is in the
 * event, the note and actions at the foot (download, details, and More for
 * reporting, blocking and deleting). Desktop: arrow keys and side arrows.
 * Phone: swipe sideways for the next clip, or down to close. The bars sit
 * above and below the clip, never on the video's own controls.
 */
export function Viewer({
  file,
  position,
  onClose,
  onDelete,
  onBlocked,
  onPrev,
  onNext,
}: {
  file: InboxFile;
  /** Where it is in the event: its index, and how many clips there are. */
  position?: { index: number; total: number };
  onClose: () => void;
  onDelete: (file: InboxFile) => void;
  /** Blocking its sender took these clips out of the inbox, this one among them. */
  onBlocked: (removedIds: string[]) => void;
  onPrev?: () => void;
  onNext?: () => void;
}) {
  const dialog = useModalDialog(true);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const [details, setDetails] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [reporting, setReporting] = useState<InboxFile | null>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const { confirm, toast } = useFeedback();
  const { block } = useModeration();
  const sender = file.contributorName ?? "this sender";

  const view = useQuery({
    queryKey: ["file-url", file.id],
    queryFn: () => fileUrl(file.id, false),
    staleTime: URL_STALE_MS,
  });
  // Resolved up front so downloading is a plain link click, which every browser allows.
  const download = useQuery({
    queryKey: ["file-download", file.id],
    queryFn: () => fileUrl(file.id, true),
    staleTime: URL_STALE_MS,
  });

  const closeMenu = (refocus = true) => {
    setMenuOpen(false);
    if (refocus) menuButton.current?.focus();
  };

  // The menu takes focus when it opens, on its first item.
  useEffect(() => {
    if (menuOpen) menu.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
  }, [menuOpen]);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      // Another dialog on top (e.g. "Delete this file?") owns the keyboard, as
      // does the open menu, and arrows on the video (seeking) or a field belong
      // to that element. Buttons don't use arrows.
      if (e.defaultPrevented || menuOpen || document.querySelectorAll("dialog[open]").length > 1)
        return;
      if (
        e.target instanceof Element &&
        e.target.closest("video, input, select, textarea, [role=slider], [role=menu]")
      )
        return;
      const go = e.key === "ArrowLeft" ? onPrev : onNext;
      if (!go) return;
      e.preventDefault();
      go();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onPrev, onNext, menuOpen]);

  const onTouchStart = (e: TouchEvent) => {
    const t = e.touches[0];
    touchStart.current = t && e.touches.length === 1 ? { x: t.clientX, y: t.clientY } : null;
  };
  const onTouchEnd = (e: TouchEvent) => {
    const start = touchStart.current;
    const t = e.changedTouches[0];
    touchStart.current = null;
    if (!start || !t) return;
    const action = swipeAction(t.clientX - start.x, t.clientY - start.y);
    if (action === "next") onNext?.();
    else if (action === "prev") onPrev?.();
    else if (action === "close") onClose();
  };

  /** Up and down through the menu's items, wrapping round. */
  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const items = [...(menu.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    const next =
      e.key === "Home"
        ? 0
        : e.key === "End"
          ? items.length - 1
          : (at + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  };

  const blockSender = async () => {
    closeMenu(false);
    const ok = await confirm({
      title: `Block ${sender}?`,
      description:
        "Their clips leave your inbox, and they can’t send you more. You can unblock them in the Hop app, under Account.",
      confirmLabel: "Block",
      tone: "danger",
    });
    if (!ok) return;
    try {
      const { removedIds } = await block.mutateAsync(file);
      toast(`${sender} is blocked`);
      onBlocked(removedIds);
    } catch (error) {
      toast(blockProblem(error), "error");
    }
  };

  return (
    <dialog
      ref={dialog}
      aria-label={`${file.name} from ${file.contributorName ?? "unknown"}`}
      onCancel={(e) => {
        // React passes a nested dialog's cancel (the report form's Esc) up to
        // this one: that closes only the report form.
        if (e.target !== e.currentTarget) return;
        e.preventDefault();
        // Esc closes the menu first, then the viewer.
        if (menuOpen) closeMenu();
        else onClose();
      }}
      className="m-0 h-dvh max-h-none w-screen max-w-none bg-black p-0 text-white backdrop:bg-black"
    >
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-3 px-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 sm:px-4">
          <button
            type="button"
            className={`inline-flex shrink-0 ${roundButton}`}
            onClick={onClose}
            aria-label="Close"
          >
            <X className="size-5" />
          </button>
          <div className="min-w-0 flex-1 [text-shadow:0_1px_8px_rgb(0_0_0/0.4)]">
            <p className="truncate text-[15px] font-semibold">
              <ContributorLabel file={file} />
            </p>
            <p className="truncate text-xs text-white/70">
              <time
                dateTime={new Date(file.createdAt).toISOString()}
                title={formatDate(file.createdAt)}
              >
                {relativeTime(file.createdAt)}
              </time>{" "}
              · {formatBytes(file.size)}
            </p>
          </div>
          {position && position.total > 1 && (
            <p
              className={`shrink-0 rounded-full px-3 py-1.5 text-[13px] font-semibold tabular-nums ${glass}`}
            >
              {position.index + 1} of {position.total}
            </p>
          )}
        </div>

        <div
          className="relative flex min-h-0 flex-1 items-center justify-center"
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
        >
          {view.data ? (
            file.mime.startsWith("image/") ? (
              <img
                src={view.data}
                alt={file.name}
                className="max-h-full max-w-full object-contain"
              />
            ) : (
              // biome-ignore lint/a11y/useMediaCaption: user-generated clips have no captions
              <video
                key={file.id}
                src={view.data}
                controls
                autoPlay
                playsInline
                className="max-h-full max-w-full"
              />
            )
          ) : view.isError ? (
            <p className={`rounded-full px-4 py-2 text-sm ${glass}`}>Couldn’t load this clip</p>
          ) : (
            <div className="skeleton aspect-video w-2/3 rounded-3xl opacity-20" />
          )}
          <button
            type="button"
            className={`absolute left-4 hidden sm:inline-flex ${roundButton}`}
            onClick={onPrev}
            disabled={!onPrev}
            aria-label="Previous"
          >
            <ChevronLeft className="size-6" />
          </button>
          <button
            type="button"
            className={`absolute right-4 hidden sm:inline-flex ${roundButton}`}
            onClick={onNext}
            disabled={!onNext}
            aria-label="Next"
          >
            <ChevronRight className="size-6" />
          </button>
        </div>

        <div className="mx-auto flex w-full max-w-lg flex-col gap-2.5 px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {file.note && <p className={`rounded-2xl px-4 py-2.5 text-sm ${glass}`}>“{file.note}”</p>}
          {details && (
            <dl id={`${menuId}-details`} className={`rounded-2xl px-4 py-2 text-sm ${glass}`}>
              <Detail label="From">
                <ContributorLabel file={file} className="justify-end" />
              </Detail>
              <Detail label="Sent">{formatDate(file.createdAt)}</Detail>
              <Detail label="File">{file.name}</Detail>
              <Detail label="Size">{formatBytes(file.size)}</Detail>
            </dl>
          )}
          <div className="flex items-center justify-center gap-2">
            {download.data ? (
              <a className={cx(pillButton, "flex-1")} href={download.data}>
                <Download className="size-4" /> Download
              </a>
            ) : (
              <button type="button" className={cx(pillButton, "flex-1")} disabled>
                <Download className="size-4" /> Download
              </button>
            )}
            <button
              type="button"
              className={cx(pillButton, "flex-1")}
              aria-pressed={details}
              aria-controls={details ? `${menuId}-details` : undefined}
              onClick={() => setDetails((open) => !open)}
            >
              <Info className="size-4" /> Details
            </button>
            <div className="relative">
              <button
                ref={menuButton}
                type="button"
                className={pillButton}
                aria-label="More"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                aria-controls={menuOpen ? menuId : undefined}
                onClick={() => (menuOpen ? closeMenu() : setMenuOpen(true))}
              >
                <Ellipsis className="size-5" />
              </button>
              {menuOpen && (
                <>
                  {/* Clicking anywhere else closes it. */}
                  <div
                    aria-hidden="true"
                    className="fixed inset-0"
                    onClick={() => closeMenu(false)}
                  />
                  <div
                    ref={menu}
                    id={menuId}
                    role="menu"
                    aria-label="More"
                    tabIndex={-1}
                    onKeyDown={onMenuKey}
                    // Darker than the bars' glass: it sits over the clip, and must read.
                    className="animate-fade-up absolute right-0 bottom-full mb-2 w-60 rounded-2xl border border-white/15 bg-neutral-900/85 p-1.5 text-white shadow-lift backdrop-blur-xl"
                  >
                    <MenuItem
                      icon={<Flag className="size-4" />}
                      onClick={() => {
                        closeMenu(false);
                        setReporting(file);
                      }}
                    >
                      Report clip…
                    </MenuItem>
                    <MenuItem icon={<Hand className="size-4" />} onClick={blockSender}>
                      <span className="truncate">Block {sender}</span>
                    </MenuItem>
                    <div className="my-1 border-t border-white/10" />
                    <MenuItem
                      icon={<Trash2 className="size-4" />}
                      danger
                      onClick={() => {
                        closeMenu(false);
                        onDelete(file);
                      }}
                    >
                      Delete clip
                    </MenuItem>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
      <ReportClipDialog file={reporting} onClose={() => setReporting(null)} onBlocked={onBlocked} />
    </dialog>
  );
}

function MenuItem({
  icon,
  danger,
  onClick,
  children,
}: {
  icon: ReactNode;
  danger?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cx(
        "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[15px] font-medium outline-none hover:bg-white/10 focus-visible:bg-white/15",
        danger ? "text-red-300" : "text-white",
      )}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </button>
  );
}
