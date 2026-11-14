import { createRootRoute, createRoute, createRouter, Outlet } from "@tanstack/react-router";
import { Contribute } from "./routes/Contribute";
import { Hops } from "./routes/Hops";
import { Inbox } from "./routes/Inbox";
import { Landing } from "./routes/Landing";
import { Onboarding } from "./routes/Onboarding";

const rootRoute = createRootRoute({ component: Outlet });

const landingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: Landing,
});
const inboxRoute = createRoute({ getParentRoute: () => rootRoute, path: "/app", component: Inbox });
const onboardingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/app/onboarding",
  component: Onboarding,
});
const hopsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/app/hops",
  component: Hops,
});

// Static routes above win over these dynamic ones; reserved handles keep them apart.
const handleRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/$handle",
  component: function HandlePage() {
    const { handle } = handleRoute.useParams();
    return <Contribute handle={handle} />;
  },
});
const hopRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/$handle/$slug",
  component: function HopPage() {
    const { handle, slug } = hopRoute.useParams();
    return <Contribute handle={handle} slug={slug} />;
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

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
