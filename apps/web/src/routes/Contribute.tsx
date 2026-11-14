import { useQuery } from "@tanstack/react-query";
import { WifiOff } from "lucide-react";
import { useEffect, useState } from "react";
import { Logo } from "../components/Logo";
import { AccentScope } from "../components/ui/AccentScope";
import { PageSpinner } from "../components/ui/Spinner";
import type { MascotState } from "../features/mascot/Mascot";
import { Dropzone } from "../features/upload/Dropzone";
import { HopHero, ownerNames } from "../features/upload/HopHero";
import { HumanCheck } from "../features/upload/HumanCheck";
import { SenderName } from "../features/upload/SenderName";
import { StatusScreen } from "../features/upload/StatusScreen";
import { UploadList } from "../features/upload/UploadList";
import { useContributorName } from "../features/upload/useContributorName";
import { useOnline } from "../features/upload/useOnline";
import { usePass } from "../features/upload/usePass";
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
    if (!allDone || doneCount === 0) return;
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

/** onmyhop.com/<handle>[/<slug>]: where anyone sends their clips. */
export function Contribute({ handle, slug }: { handle: string; slug?: string }) {
  const hopQuery = useQuery(queries.publicHop(handle, slug));
  const config = useQuery(queries.config());
  const me = useQuery(queries.me());
  const hop = hopQuery.data;

  const contributor = useContributorName();
  const pass = usePass(hop?.id);
  const queue = useUploadQueue(hop?.id, pass.getPass, contributor.getName);
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
    return (
      <StatusScreen mascot="sleep" color={hop.owner.color} title="This Hop is closed">
        {ownerNames(hop).full} isn’t accepting uploads here right now.
      </StatusScreen>
    );
  }

  const verifiedAs = me.data ? (me.data.handle ? `@${me.data.handle}` : me.data.name) : null;
  const { uploader, items, busy, doneCount, allDone } = queue;
  const phase = busy ? "sending" : allDone ? "done" : "ready";
  const started = items.length > 0;

  return (
    <AccentScope color={hop.owner.color} seed={hop.owner.handle}>
      <main className="mx-auto flex min-h-dvh max-w-md flex-col px-5 pt-5 pb-8">
        <header>
          <Logo color={hop.owner.color} />
        </header>

        <div className={started ? "mt-6" : "mt-10"}>
          <HopHero hop={hop} phase={phase} doneCount={doneCount} mascot={mascot} />
        </div>

        {!online && (
          <p
            role="status"
            className="mt-6 flex items-center justify-center gap-2 rounded-full bg-surface-2 px-4 py-2.5 text-sm font-medium"
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

        <div className={started ? "mt-4" : "mt-8"}>
          <Dropzone compact={started} onFiles={(files) => uploader?.add(files)} />
        </div>

        <div className="mt-3 flex min-h-11 items-center justify-center">
          <SenderName
            verifiedAs={verifiedAs}
            name={contributor.name}
            onChange={contributor.setName}
            signInHref={signInUrl()}
          />
        </div>

        <HumanCheck
          siteKey={config.data?.turnstileSiteKey}
          widgetRef={pass.turnstile}
          error={pass.error}
          onToken={pass.onToken}
          onError={pass.onWidgetError}
          onRetry={pass.retry}
        />

        <footer className="mt-auto pt-12 text-center text-xs text-muted">
          Only {ownerNames(hop).full} can see what you send · Hop by Caliplaces
        </footer>
      </main>
    </AccentScope>
  );
}
