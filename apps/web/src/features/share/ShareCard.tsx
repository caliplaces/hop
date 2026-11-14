import { Check, Copy, QrCode, Share } from "lucide-react";
import { useState } from "react";
import { Button, IconButton } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { displayHopUrl } from "../../lib/format";
import { QrDialog } from "./QrDialog";
import { canShare, shareHop } from "./share";
import { useCopy } from "./useCopy";

/** The athlete's link, front and centre: share it, copy it, or show the QR. */
export function ShareCard({ url, title }: { url: string; title: string }) {
  const [qrOpen, setQrOpen] = useState(false);
  const { copied, copy } = useCopy(url);
  const share = () => shareHop(url);
  const CopyIcon = copied ? Check : Copy;

  return (
    <Card>
      <p className="text-sm font-medium text-muted">Your link · uploads go to {title}</p>
      <button
        type="button"
        onClick={copy}
        className="mt-1 block max-w-full truncate text-left text-2xl font-semibold tracking-tight sm:text-3xl"
        title="Copy link"
      >
        {displayHopUrl(url)}
      </button>
      <div className="mt-5 flex flex-wrap gap-2">
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
