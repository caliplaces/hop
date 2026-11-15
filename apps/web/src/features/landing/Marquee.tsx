import {
  CalendarDays,
  Code,
  FolderDown,
  Globe,
  HardDrive,
  Lock,
  QrCode,
  Smartphone,
  Sparkles,
  UserRoundX,
} from "lucide-react";

const ITEMS = [
  { icon: Smartphone, label: "No app to install" },
  { icon: UserRoundX, label: "No account to send" },
  { icon: Sparkles, label: "Original quality" },
  { icon: HardDrive, label: "Up to 5 GB a file" },
  { icon: Globe, label: "iPhone and Android" },
  { icon: QrCode, label: "A QR code for your bib" },
  { icon: CalendarDays, label: "A Hop for every event" },
  { icon: Lock, label: "Private by default" },
  { icon: FolderDown, label: "Download all in one .zip" },
  { icon: Code, label: "Open source" },
];

/** A slow, endless strip of what Hop promises. The list is doubled so it loops seamlessly. */
export function Marquee() {
  return (
    <div className="lp-marquee overflow-hidden py-10 sm:py-14">
      <ul className="sr-only">
        {ITEMS.map(({ label }) => (
          <li key={label}>{label}</li>
        ))}
      </ul>
      <div aria-hidden="true" className="lp-marquee-track">
        {[0, 1].map((copy) => (
          <div key={copy} className="flex shrink-0 items-center">
            {ITEMS.map(({ icon: Icon, label }) => (
              <span
                key={label}
                className="flex items-center gap-2.5 px-6 text-[15px] font-medium whitespace-nowrap text-white/55 sm:px-8"
              >
                <Icon className="size-4 text-white/35" />
                {label}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
