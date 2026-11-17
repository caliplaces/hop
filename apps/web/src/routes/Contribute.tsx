import { useQuery } from "@tanstack/react-query";
import { WifiOff } from "lucide-react";
import { useEffect, useState } from "react";
import { Logo } from "../components/Logo";
import { AccentScope } from "../components/ui/AccentScope";
import { cx } from "../components/ui/cx";
import { PageSpinner } from "../components/ui/Spinner";
import type { MascotState } from "../features/mascot/Mascot";
import { Dropzone } from "../features/upload/Dropzone";
import { HopHero, ownerNames } from "../features/upload/HopHero";
import { HumanCheck } from "../features/upload/HumanCheck";
import { RecipientPass } from "../features/upload/RecipientPass";
import { ReportPage } from "../features/upload/ReportPage";
import { SenderCard } from "../features/upload/SenderName";
import { SendingBar } from "../features/upload/SendingBar";
import { StatusScreen } from "../features/upload/StatusScreen";
import { UploadList } from "../features/upload/UploadList";
import { useContributorName } from "../features/upload/useContributorName";
import { useOnline } from "../features/upload/useOnline";
import { usePass } from "../features/upload/usePass";
import { useUploadNote } from "../features/upload/useUploadNote";
import { useUploadQueue } from "../features/upload/useUploadQueue";
import { signInUrl } from "../lib/api";
import { queries } from "../lib/queries";

const CHEER_MS = 3000;

/**
 * Bobble narrates the upload: balancing the clip while sending, a celebration
 * when everything lands, sitting broken if something failed or the
 * connection dropped, idle otherwise.
 */
function useUploadMascot(queue: ReturnType<typeof useUploadQueue>, online: boolean): MascotState {
  const { items, busy, doneCount, allDone } = queue;
  const [celebrating, setCelebrating] = useState(false);
  useEffect(() => {
    if (!allDone || doneCount === 0) {
      setCelebrating(false);
      return;
    }
    setCelebrating(true);
    const timer = setTimeout(() => setCelebrating(false), CHEER_MS);
    return () => clearTimeout(timer);
  }, [allDone, doneCount]);

  if (!online) return "broken";
  if (busy) return "busy";
  if (celebrating) return "cheer";
  if (items.some((i) => i.status === "error")) return "broken";
  return "idle";
}

/** The page's foot: who sees what's sent, and reporting the page. */
function Footer({ handle, owner, siteKey }: { handle: string; owner: string; siteKey?: string }) {
  return (
    <footer className="mt-auto flex flex-col items-center gap-2 pt-12 text-center text-xs text-muted">
      <p>Only {owner} can see what you send · Hop by Caliplaces</p>
      <p className="flex items-center gap-3">
        <ReportPage handle={handle} siteKey={siteKey} />
        <span aria-hidden="true">·</span>
        <a className="underline-offset-4 hover:underline" href="/privacy">
          Privacy
        </a>
        <span aria-hidden="true">·</span>
        <a className="underline-offset-4 hover:underline" href="/terms">
          Terms
        </a>
      </p>
    </footer>
  );
}

/**
 * onmyhop.com/<handle>[/<slug>]: where anyone sends their clips. As the
 * iPhone app looks: the athlete's pass up top in their colour, Bobble
 * narrating, glass for everything to tap, and a floating bar while sending.
 */
export function Contribute({ handle, slug }: { handle: string; slug?: string }) {
  const hopQuery = useQuery(queries.publicHop(handle, slug));
  const config = useQuery(queries.config());
  const me = useQuery(queries.me());
  const hop = hopQuery.data;

  const contributor = useContributorName();
  const note = useUploadNote();
  const pass = usePass(hop?.id);
  const queue = useUploadQueue(hop?.id, pass.getPass, contributor.getName, note.getNote);
  const online = useOnline();
  const mascot = useUploadMascot(queue, online);

  if (hopQuery.isPending) return <PageSpinner />;
  if (!hop) {
    return (
      <StatusScreen mascot="broken" title="No Hop here">
        Double-check the link. It should look like onmyhop.com/handle.
      </StatusScreen>
    );
  }
  if (hop.status === "closed") {
    // The page still shows their name, so it can still be reported.
    return (
      <StatusScreen
        mascot="sleep"
        color={hop.owner.color}
        title="This Hop is closed"
        top={<RecipientPass hop={hop} />}
        action={
          <span className="text-xs text-muted">
            <ReportPage handle={hop.owner.handle} siteKey={config.data?.turnstileSiteKey} />
          </span>
        }
      >
        {ownerNames(hop).full} isn’t accepting uploads here right now.
      </StatusScreen>
    );
  }

  const verifiedAs = me.data ? (me.data.handle ? `@${me.data.handle}` : me.data.name) : null;
  const { uploader, items, busy, doneCount, allDone } = queue;
  const phase = busy ? "sending" : allDone ? "done" : "ready";
  const started = items.length > 0;
  const { first, full } = ownerNames(hop);

  return (
    <AccentScope color={hop.owner.color} seed={hop.owner.handle} className="relative min-h-dvh">
      <div
        aria-hidden="true"
        className="aura pointer-events-none absolute inset-x-0 top-0 h-[30rem]"
      />
      <main
        className={cx(
          "relative mx-auto flex min-h-dvh max-w-md flex-col px-4 pt-4 sm:px-5",
          // Room for the floating bar, so it never covers the foot of the page.
          busy ? "pb-28" : "pb-8",
        )}
      >
        <header className="flex items-center">
          <Logo color={hop.owner.color} />
        </header>

        <div className="mt-5">
          <RecipientPass hop={hop} />
        </div>

        <div className={started ? "mt-4" : "mt-6"}>
          <HopHero hop={hop} phase={phase} doneCount={doneCount} mascot={mascot} />
        </div>

        {!online && (
          <p
            role="status"
            className="glass mt-5 flex items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm font-medium"
          >
            <WifiOff className="size-4" /> You’re offline. Uploads continue when you’re back.
          </p>
        )}

        {/* Once something is uploading, the list is the main thing; adding more is secondary. */}
        {uploader && started && (
          <div className="mt-6">
            <UploadList items={items} uploader={uploader} canClear={!busy && doneCount > 0} />
          </div>
        )}

        <div className={started ? "mt-3" : "mt-7"}>
          <Dropzone compact={started} onFiles={(files) => uploader?.add(files)} />
        </div>

        <div className="mt-3">
          <SenderCard
            verifiedAs={verifiedAs}
            name={contributor.name}
            onNameChange={contributor.setName}
            signInHref={signInUrl()}
            note={note.note}
            onNoteChange={note.setNote}
            recipient={first}
            started={started}
          />
        </div>

        {/* Invisible for most people: no spacing of its own until it shows something. */}
        <HumanCheck
          siteKey={config.data?.turnstileSiteKey}
          widgetRef={pass.turnstile}
          error={pass.error}
          onToken={pass.onToken}
          onError={pass.onWidgetError}
          onRetry={pass.retry}
        />

        <Footer handle={hop.owner.handle} owner={full} siteKey={config.data?.turnstileSiteKey} />
      </main>
      <SendingBar items={items} />
    </AccentScope>
  );
}
