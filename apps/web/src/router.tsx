import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  Outlet,
  redirect,
} from "@tanstack/react-router";
import { PageSpinner } from "./components/ui/Spinner";

/*
 * Every page is its own chunk: a contributor opening onmyhop.com/<handle> on
 * event Wi-Fi downloads only the upload page, never the inbox, zip or QR code.
 */
const rootRoute = createRootRoute({ component: Outlet });

const landingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: lazyRouteComponent(() => import("./routes/Landing"), "Landing"),
});
export type InboxSearch = { hop?: string };

const inboxRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/app",
  // The Hop filter lives in the URL, so a Hop card can link to its files.
  validateSearch: (search: Record<string, unknown>): InboxSearch => ({
    hop: typeof search.hop === "string" && search.hop ? search.hop : undefined,
  }),
  // Links from before events had their own page (new-clips emails among
  // them) open that event's page.
  beforeLoad: ({ search }) => {
    if (search.hop) throw redirect({ to: "/app/events/$hopId", params: { hopId: search.hop } });
  },
  component: lazyRouteComponent(() => import("./routes/Inbox"), "Inbox"),
});
const eventRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/app/events/$hopId",
  component: lazyRouteComponent(() => import("./routes/Event"), "Event"),
});
const onboardingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/app/onboarding",
  component: lazyRouteComponent(() => import("./routes/Onboarding"), "Onboarding"),
});
const myHopRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/app/my-hop",
  component: lazyRouteComponent(() => import("./routes/MyHop"), "MyHop"),
});
// Where events were managed before My Hop.
const hopsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/app/hops",
  beforeLoad: () => {
    throw redirect({ to: "/app/my-hop" });
  },
});

const unsubscribeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/unsubscribe",
  validateSearch: (search: Record<string, unknown>): { token?: string } => ({
    token: typeof search.token === "string" && search.token ? search.token : undefined,
  }),
  component: lazyRouteComponent(() => import("./routes/Unsubscribe"), "Unsubscribe"),
});

const privacyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/privacy",
  component: lazyRouteComponent(() => import("./routes/Privacy"), "Privacy"),
});

const adminRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin",
  component: lazyRouteComponent(() => import("./routes/Admin"), "Admin"),
});

// Static routes above win over these dynamic ones; reserved handles keep them apart.
const ContributePage = lazyRouteComponent(() => import("./routes/Contribute"), "Contribute");
const handleRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/$handle",
  component: function HandlePage() {
    const { handle } = handleRoute.useParams();
    return <ContributePage handle={handle} />;
  },
});
const hopRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/$handle/$slug",
  component: function HopPage() {
    const { handle, slug } = hopRoute.useParams();
    return <ContributePage handle={handle} slug={slug} />;
  },
});

const routeTree = rootRoute.addChildren([
  landingRoute,
  inboxRoute,
  eventRoute,
  onboardingRoute,
  myHopRoute,
  hopsRoute,
  unsubscribeRoute,
  privacyRoute,
  adminRoute,
  handleRoute,
  hopRoute,
]);

export const router = createRouter({
  routeTree,
  defaultPendingComponent: PageSpinner,
  defaultPreload: "intent",
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
