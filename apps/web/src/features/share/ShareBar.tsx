import { Check, Copy, QrCode, Share } from "lucide-react";
import { useState } from "react";
import { IconButton } from "../../components/ui/Button";
import { displayHopUrl } from "../../lib/format";
import { QrDialog } from "./QrDialog";
import { canShare, shareHop } from "./share";
import { useCopy } from "./useCopy";

/** One-row version of ShareCard for the inbox, where the clips should come first. */
export function ShareBar({ url, title }: { url: string; title: string }) {
  const [qrOpen, setQrOpen] = useState(false);
  const { copied, copy } = useCopy(url);
  const CopyIcon = copied ? Check : Copy;

  return (
    <div className="flex items-center gap-1 rounded-full border border-line bg-surface py-1.5 pr-1.5 pl-5 shadow-soft">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-semibold tracking-tight">{displayHopUrl(url)}</p>
        <p className="truncate text-xs text-muted">Uploads go to {title}</p>
      </div>
      <IconButton label="Copy link" onClick={copy}>
        <CopyIcon className="size-[18px]" />
      </IconButton>
      <IconButton label="Show QR code" onClick={() => setQrOpen(true)}>
        <QrCode className="size-[18px]" />
      </IconButton>
      {canShare && (
        <IconButton
          label="Share link"
          className="bg-hop text-ink hover:bg-hop-strong"
          onClick={() => shareHop(url)}
        >
          <Share className="size-[18px]" />
        </IconButton>
      )}
      <QrDialog url={url} title={title} open={qrOpen} onClose={() => setQrOpen(false)} />
    </div>
  );
}
