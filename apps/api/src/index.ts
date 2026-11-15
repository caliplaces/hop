import { Hono } from "hono";
import { csrf } from "hono/csrf";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";
import { cleanup } from "./cron";
import { ONE_CLICK_UNSUBSCRIBE_PATH } from "./email/unsubscribe";
import type { AppEnv, Env } from "./env";
import { announceLaunch } from "./launch";
import { fail } from "./lib/http";
import { APP_SITE_ASSOCIATION_PATH, appSiteAssociation } from "./lib/oidc";
import { loadSession } from "./lib/session";
import { announceNewClips } from "./notify";
import { authRoutes } from "./routes/auth";
import { billingRoutes } from "./routes/billing";
import { devRoutes } from "./routes/dev";
import { emailRoutes } from "./routes/email";
import { liveActivityRoutes } from "./routes/live";
import { meRoutes } from "./routes/me";
import { publicRoutes } from "./routes/public";
import { uploadRoutes } from "./routes/uploads";
import { waitlistRoutes } from "./routes/waitlist";

/** Keep in sync with "triggers" in wrangler.jsonc; every other schedule runs the digest. */
const CLEANUP_CRON = "17 * * * *";

const app = new Hono<AppEnv>().basePath("/api");

// Reject cross-site form posts; JSON requests already need a CORS preflight we never grant.
// One-click unsubscribe is the exception: mail providers POST it from their own
// servers, and it's authorised by the signed token in its URL, not by a cookie.
const csrfProtection = csrf({ origin: (origin, c) => origin === c.env.APP_URL });
app.use((c, next) =>
  c.req.path === ONE_CLICK_UNSUBSCRIBE_PATH ? next() : csrfProtection(c, next),
);
app.use(
  secureHeaders({
    // API responses are JSON (or thumbnails); nothing here should ever render as a page.
    contentSecurityPolicy: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
    strictTransportSecurity: "max-age=31536000; includeSubDomains",
    referrerPolicy: "strict-origin-when-cross-origin",
    crossOriginResourcePolicy: "same-origin",
  }),
);
app.use(loadSession);

app.get("/health", (c) => c.json({ ok: true }));
app.route("/auth", authRoutes);
app.route("/email", emailRoutes);
app.route("/", publicRoutes);
app.route("/", meRoutes);
app.route("/", uploadRoutes);
app.route("/", liveActivityRoutes);
app.route("/", billingRoutes);
app.route("/", waitlistRoutes);
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);
app.use("/dev/*", async (c, next) => {
  // Belt and braces: even a mistaken deploy with development vars can't expose these.
  const local = LOCAL_HOSTS.has(new URL(c.req.url).hostname);
  if (c.env.ENVIRONMENT !== "development" || !local) return fail(c, 404, "not_found");
  await next();
});
app.route("/dev", devRoutes);

app.notFound((c) => fail(c, 404, "not_found"));
app.onError((error, c) => {
  if (error instanceof HTTPException) return error.getResponse();
  console.error(error);
  return fail(c, 500, "internal_error", "Something went wrong on our side.");
});

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    // The one file outside /api: Apple reads it to tie this site to the app.
    if (new URL(request.url).pathname === APP_SITE_ASSOCIATION_PATH) {
      return appSiteAssociation(request, env);
    }
    return app.fetch(request, env, ctx);
  },
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(
      controller.cron === CLEANUP_CRON
        ? cleanup(env)
        : // Separately, so one failing can't hold up the other.
          Promise.allSettled([announceNewClips(env), announceLaunch(env)]),
    );
  },
} satisfies ExportedHandler<Env>;

export type { AppEnv };
