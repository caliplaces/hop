import { APP_STORE_URL, GOOGLE_PLAY_URL } from "@hop/shared";
import { cx } from "../../components/ui/cx";

const badge =
  "rounded-[9px] transition hover:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white";

/**
 * The app on the App Store and Google Play, in the stores' own badges. Until
 * Google Play has it, Android gets a note that it's coming instead.
 */
export function StoreBadges({ className }: { className?: string }) {
  return (
    <div className={cx("flex flex-wrap items-center justify-center gap-3", className)}>
      <a href={APP_STORE_URL} className={badge}>
        <img
          src="/badges/app-store.svg"
          alt="Download on the App Store"
          width={120}
          height={40}
          className="h-10 w-auto"
        />
      </a>
      {GOOGLE_PLAY_URL ? (
        <a href={GOOGLE_PLAY_URL} className={badge}>
          <img
            src="/badges/google-play.png"
            alt="Get it on Google Play"
            width={134}
            height={40}
            className="h-10 w-auto"
          />
        </a>
      ) : (
        <span className="inline-flex h-10 items-center rounded-[9px] border border-white/15 px-3.5 text-[13px] font-medium text-white/55">
          Android coming soon
        </span>
      )}
    </div>
  );
}
