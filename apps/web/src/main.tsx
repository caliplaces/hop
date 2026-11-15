import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { FeedbackProvider } from "./components/ui/feedback";
import { applyPageTheme } from "./lib/pageTheme";
import { router } from "./router";
import "./styles.css";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } },
});

const root = document.getElementById("root");
if (!root) throw new Error("#root missing");

// The landing page is always dark. Pin it now, before its chunk loads, so a
// light-mode visitor doesn't see a light flash first; Landing takes over from here.
if (window.location.pathname === "/") applyPageTheme("dark");

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <FeedbackProvider>
        <RouterProvider router={router} />
      </FeedbackProvider>
    </QueryClientProvider>
  </StrictMode>,
);
