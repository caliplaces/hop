import { useEffect, useState } from "react";

/** PNG data URL of a QR code. The qrcode library loads only when a QR is first shown. */
export function useQrCode(text: string, enabled: boolean): string | null {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    import("qrcode")
      .then((QRCode) =>
        QRCode.toDataURL(text, {
          margin: 1,
          width: 768,
          errorCorrectionLevel: "M",
          color: { dark: "#0b0b0c", light: "#ffffff" },
        }),
      )
      .then((url) => !cancelled && setDataUrl(url))
      .catch(() => !cancelled && setDataUrl(null));
    return () => {
      cancelled = true;
    };
  }, [text, enabled]);
  return dataUrl;
}
