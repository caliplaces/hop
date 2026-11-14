import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  Outlet,
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
const inboxRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/app",
  component: lazyRouteComponent(() => import("./routes/Inbox"), "Inbox"),
});
const onboardingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/app/onboarding",
  component: lazyRouteComponent(() => import("./routes/Onboarding"), "Onboarding"),
});
const hopsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/app/hops",
  component: lazyRouteComponent(() => import("./routes/Hops"), "Hops"),
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
  onboardingRoute,
  hopsRoute,
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
