import { Check, Copy, Download } from "lucide-react";
import { Button, buttonClass } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import { displayHopUrl } from "../../lib/format";
import { useCopy } from "./useCopy";
import { useQrCode } from "./useQrCode";

export function QrDialog({
  url,
  title,
  open,
  onClose,
}: {
  url: string;
  title: string;
  open: boolean;
  onClose: () => void;
}) {
  const qr = useQrCode(url, open);
  const { copied, copy } = useCopy(url);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Your Hop"
      description={`Uploads go to ${title}`}
      size="sm"
    >
      <div className="rounded-3xl bg-white p-4">
        {qr ? (
          <img
            src={qr}
            alt={`QR code for ${displayHopUrl(url)}`}
            className="aspect-square w-full"
          />
        ) : (
          <div className="skeleton aspect-square w-full rounded-2xl" />
        )}
      </div>
      <p className="mt-4 text-center text-lg font-semibold tracking-tight">{displayHopUrl(url)}</p>
      <p className="text-center text-sm text-muted">Say it out loud: “upload it on my Hop”</p>
      <div className="mt-5 grid grid-cols-2 gap-2">
        <Button variant="soft" onClick={copy}>
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          {copied ? "Copied" : "Copy link"}
        </Button>
        {qr ? (
          <a className={buttonClass({ variant: "soft" })} href={qr} download="hop-qr.png">
            <Download className="size-4" /> Save QR
          </a>
        ) : (
          <Button variant="soft" disabled>
            <Download className="size-4" /> Save QR
          </Button>
        )}
      </div>
    </Dialog>
  );
}
