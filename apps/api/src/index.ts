import { Hono } from "hono";
import { csrf } from "hono/csrf";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";
import { cleanup } from "./cron";
import type { AppEnv, Env } from "./env";
import { fail } from "./lib/http";
import { loadSession } from "./lib/session";
import { authRoutes } from "./routes/auth";
import { devRoutes } from "./routes/dev";
import { meRoutes } from "./routes/me";
import { publicRoutes } from "./routes/public";
import { uploadRoutes } from "./routes/uploads";

const app = new Hono<AppEnv>().basePath("/api");

// Reject cross-site form posts; JSON requests already need a CORS preflight we never grant.
app.use(csrf({ origin: (origin, c) => origin === c.env.APP_URL }));
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
app.route("/", publicRoutes);
app.route("/", meRoutes);
app.route("/", uploadRoutes);
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
  fetch: app.fetch,
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(cleanup(env));
  },
} satisfies ExportedHandler<Env>;

export type { AppEnv };
