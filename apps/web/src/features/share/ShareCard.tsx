import { Check, Copy, QrCode, Share } from "lucide-react";
import { useState } from "react";
import { Button, IconButton } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { displayHopUrl } from "../../lib/format";
import { QrDialog } from "./QrDialog";
import { useCopy } from "./useCopy";

const canShare = typeof navigator !== "undefined" && "share" in navigator;

/** The athlete's link, front and centre: share it, copy it, or show the QR. */
export function ShareCard({ url, title }: { url: string; title: string }) {
  const [qrOpen, setQrOpen] = useState(false);
  const { copied, copy } = useCopy(url);
  const share = () =>
    navigator
      .share?.({ title: "Upload it on my Hop", text: "Send me your clips 🙌", url })
      .catch(() => {});
  const CopyIcon = copied ? Check : Copy;

  return (
    <Card className="relative overflow-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-20 -right-16 size-56 rounded-full bg-hop/25 blur-3xl"
      />
      <p className="relative text-sm font-medium text-muted">Your link · uploads go to {title}</p>
      <button
        type="button"
        onClick={copy}
        className="relative mt-1 block max-w-full truncate text-left text-2xl font-semibold tracking-tight sm:text-3xl"
        title="Copy link"
      >
        {displayHopUrl(url)}
      </button>
      <div className="relative mt-5 flex flex-wrap gap-2">
        {canShare ? (
          <Button onClick={share}>
            <Share className="size-4" /> Share
          </Button>
        ) : (
          <Button onClick={copy}>
            <CopyIcon className="size-4" /> {copied ? "Copied" : "Copy link"}
          </Button>
        )}
        <Button variant="outline" onClick={() => setQrOpen(true)}>
          <QrCode className="size-4" /> QR code
        </Button>
        {canShare && (
          <IconButton label="Copy link" bordered onClick={copy}>
            <CopyIcon className="size-4" />
          </IconButton>
        )}
      </div>
      <QrDialog url={url} title={title} open={qrOpen} onClose={() => setQrOpen(false)} />
    </Card>
  );
}
