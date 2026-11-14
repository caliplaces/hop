import { Check, Copy, Download, Share2 } from "lucide-react";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { displayHopUrl } from "../lib/format";

export function ShareCard({ url, title }: { url: string; title: string }) {
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    QRCode.toDataURL(url, {
      margin: 1,
      width: 640,
      color: { dark: "#0b0b0c", light: "#ffffff" },
    }).then(setQr, () => setQr(null));
  }, [url]);

  const copy = async () => {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const share = () =>
    navigator.share?.({ title: `Upload it on my Hop: ${title}`, url }).catch(() => {});

  return (
    <div className="card flex flex-col gap-5 sm:flex-row sm:items-center">
      {qr && (
        <img
          src={qr}
          alt={`QR code for ${displayHopUrl(url)}`}
          className="size-36 rounded-2xl bg-white p-2"
        />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm text-black/60 dark:text-white/60">
          Tell everyone: “upload it on my Hop”
        </p>
        <p className="mt-1 truncate text-2xl font-black tracking-tight">{displayHopUrl(url)}</p>
        <p className="mt-1 text-sm text-black/60 dark:text-white/60">Uploads go to: {title}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" className="btn-primary px-4 py-2" onClick={copy}>
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            {copied ? "Copied" : "Copy link"}
          </button>
          {"share" in navigator && (
            <button type="button" className="btn-ghost px-4 py-2" onClick={share}>
              <Share2 className="size-4" /> Share
            </button>
          )}
          {qr && (
            <a className="btn-ghost px-4 py-2" href={qr} download="hop-qr.png">
              <Download className="size-4" /> QR code
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
