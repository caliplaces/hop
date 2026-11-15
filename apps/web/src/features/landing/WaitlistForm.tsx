import { PALETTE } from "@hop/shared";
import { Turnstile } from "@marsidev/react-turnstile";
import { ArrowRight, Check, CircleAlert } from "lucide-react";
import type { CSSProperties } from "react";
import { cx } from "../../components/ui/cx";
import { Spinner } from "../../components/ui/Spinner";
import { LAUNCH_DAY } from "./launch";
import type { Waitlist } from "./useWaitlist";

/** Twelve bits of confetti, one per palette colour, thrown in a ring. */
function Confetti() {
  return (
    <span aria-hidden="true">
      {PALETTE.map((color, i) => {
        const angle = (i / PALETTE.length) * Math.PI * 2;
        const distance = 70 + (i % 3) * 26;
        const style = {
          backgroundColor: color.hex,
          "--x": `${Math.cos(angle) * distance}px`,
          "--y": `${Math.sin(angle) * distance * 0.7}px`,
          "--r": `${(i % 2 ? 1 : -1) * (180 + i * 30)}deg`,
        } as CSSProperties;
        return <i key={color.id} className="lp-confetti" style={style} />;
      })}
    </span>
  );
}

/** `active` is the form that was just used: it alone celebrates and announces. */
function Joined({ email, active }: { email: string; active: boolean }) {
  return (
    <div
      role={active ? "status" : undefined}
      className="animate-pop relative mx-auto inline-flex max-w-full items-center gap-3 rounded-full border border-white/10 bg-white/[0.06] py-2 pr-6 pl-2 text-left backdrop-blur-xl"
    >
      {active && <Confetti />}
      <span className="grid size-11 shrink-0 place-items-center rounded-full bg-[#3DDC97] text-black">
        <Check className="size-5" strokeWidth={3} />
      </span>
      <span className="min-w-0 leading-tight">
        <span className="block font-semibold">You’re on the list</span>
        <span className="block truncate text-sm text-white/55">
          We’ll email {email} on {LAUNCH_DAY}.
        </span>
      </span>
    </div>
  );
}

/**
 * Email field and button in one glass pill. Every form on the page shares one
 * waitlist (see useWaitlist); `id` tells them apart.
 */
export function WaitlistForm({
  id,
  waitlist,
  className,
}: {
  id: string;
  waitlist: Waitlist;
  className?: string;
}) {
  const { status } = waitlist;
  const active = waitlist.activeForm === id;
  const busy = status.kind === "sending" || status.kind === "verifying";
  const error = active && status.kind === "error" ? status.message : null;
  const inputId = `waitlist-${id}`;
  const messageId = `waitlist-${id}-message`;

  if (status.kind === "joined") {
    return (
      <div className={cx("flex justify-center", className)}>
        <Joined email={status.email} active={active} />
      </div>
    );
  }

  return (
    <div className={cx("mx-auto w-full max-w-md", className)}>
      <form
        noValidate
        onFocus={() => waitlist.arm(id)}
        onSubmit={(e) => {
          e.preventDefault();
          waitlist.submit(id, String(new FormData(e.currentTarget).get("email") ?? ""));
        }}
        className={cx(
          "lp-field flex items-center rounded-full border bg-white/[0.05] p-1.5 shadow-[0_10px_40px_-12px_rgb(0_0_0/0.6)] backdrop-blur-xl transition focus-within:bg-white/[0.07] focus-within:ring-4",
          error
            ? "border-danger/60 focus-within:ring-danger/15"
            : "border-white/12 focus-within:border-white/40 focus-within:ring-white/10",
        )}
      >
        <label htmlFor={inputId} className="sr-only">
          Email address
        </label>
        <input
          id={inputId}
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          required
          maxLength={254}
          placeholder="you@email.com"
          aria-invalid={error ? true : undefined}
          onChange={waitlist.clearError}
          aria-describedby={messageId}
          className="h-11 min-w-0 flex-1 bg-transparent pr-2 pl-4 text-base text-fg outline-none placeholder:text-white/35 sm:h-12"
        />
        <button
          type="submit"
          disabled={busy}
          className="btn h-11 bg-fg px-4 text-canvas hover:opacity-90 sm:h-12 sm:px-6"
        >
          {busy ? <Spinner className="size-4" /> : null}
          <span>
            Join<span className="hidden min-[400px]:inline"> the waitlist</span>
          </span>
          {!busy && <ArrowRight className="size-4" />}
        </button>
      </form>

      {active && waitlist.siteKey && (
        <div className="mt-3 flex justify-center empty:hidden">
          <Turnstile
            ref={waitlist.turnstile}
            siteKey={waitlist.siteKey}
            options={{ appearance: "interaction-only", action: "waitlist", theme: "dark" }}
            onSuccess={waitlist.onToken}
            onExpire={waitlist.onTokenExpired}
            onError={waitlist.onWidgetError}
          />
        </div>
      )}

      <p
        id={messageId}
        role={error ? "alert" : undefined}
        className={cx(
          "mt-3 flex min-h-5 items-center justify-center gap-1.5 text-sm",
          error ? "text-danger" : "text-white/45",
        )}
      >
        {error ? (
          <>
            <CircleAlert className="size-4 shrink-0" /> {error}
          </>
        ) : active && status.kind === "verifying" ? (
          "Checking you’re human…"
        ) : (
          `One email on ${LAUNCH_DAY}, when Hop opens.`
        )}
      </p>
    </div>
  );
}
