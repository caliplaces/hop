import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Header } from "../components/Header";
import { fetchMe, signInUrl } from "../lib/api";

const STEPS = [
  { title: "Claim your Hop", body: "Pick a handle. You get onmyhop.com/you, plus a QR code." },
  {
    title: "Say the line",
    body: "“Upload it on my Hop.” Friends, coaches and filmers send their clips from any phone. No app, no account.",
  },
  {
    title: "Everything in one place",
    body: "Every video of you lands in one private inbox. Watch, download all, done.",
  },
];

const AUTH_ERRORS: Record<string, string> = {
  denied: "Sign-in was cancelled.",
  expired: "Sign-in took too long. Please try again.",
  failed: "Sign-in didn't work. Please try again.",
};

export function Landing() {
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: fetchMe });
  const authError = new URLSearchParams(window.location.search).get("authError");

  return (
    <>
      <Header me={me} />
      <main className="mx-auto max-w-6xl px-4 sm:px-6">
        {authError && (
          <p className="mx-auto mt-4 max-w-xl rounded-2xl bg-red-500/10 px-4 py-3 text-center text-sm text-red-700 dark:text-red-300">
            {AUTH_ERRORS[authError] ?? AUTH_ERRORS.failed}
          </p>
        )}
        <section className="py-16 text-center sm:py-24">
          <p className="text-sm font-semibold uppercase tracking-widest text-black/50 dark:text-white/50">
            For athletes at events
          </p>
          <h1 className="mx-auto mt-4 max-w-3xl text-5xl font-black leading-[0.95] tracking-tighter sm:text-7xl">
            “Upload it on <span className="rounded-2xl bg-hop px-3 text-ink">my Hop</span>”
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-lg text-black/60 dark:text-white/60">
            Everyone filmed your run. Hop collects every one of those videos into a single private
            inbox. No chasing DMs, no AirDrop roulette.
          </p>
          <div className="mt-10 flex justify-center">
            {me?.handle ? (
              <Link to="/app" className="btn-primary px-8 py-4 text-base">
                Open your Hop
              </Link>
            ) : (
              <a href={signInUrl("/app")} className="btn-primary px-8 py-4 text-base">
                Continue with Caliplaces
              </a>
            )}
          </div>
        </section>

        <section className="grid gap-4 pb-24 sm:grid-cols-3">
          {STEPS.map((step, i) => (
            <div key={step.title} className="card">
              <p className="text-sm font-bold text-black/40 dark:text-white/40">0{i + 1}</p>
              <h2 className="mt-2 text-xl font-black tracking-tight">{step.title}</h2>
              <p className="mt-2 text-black/60 dark:text-white/60">{step.body}</p>
            </div>
          ))}
        </section>
      </main>
      <footer className="mx-auto max-w-6xl px-4 pb-10 text-sm text-black/50 sm:px-6 dark:text-white/50">
        Hop by Caliplaces ·{" "}
        <a className="underline" href="https://github.com/caliplaces/hop">
          Open source
        </a>
      </footer>
    </>
  );
}
