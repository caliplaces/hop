import type {
  HopSummary,
  InboxPage,
  PlanStatus,
  PublicConfig,
  PublicHop,
  WebPrice,
} from "@hop/shared";
import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import { api, fetchMe } from "./api";

/** Every query key and fetcher in one place, so pages share cache entries. */
export const queries = {
  me: () => queryOptions({ queryKey: ["me"], queryFn: fetchMe }),

  config: () =>
    queryOptions({
      queryKey: ["config"],
      queryFn: () => api<PublicConfig>("/config"),
      staleTime: Number.POSITIVE_INFINITY,
    }),

  publicHop: (handle: string, slug?: string) =>
    queryOptions({
      queryKey: ["public-hop", handle, slug ?? null],
      queryFn: () => api<PublicHop>(slug ? `/h/${handle}/${slug}` : `/h/${handle}`),
      retry: false,
    }),

  hops: () =>
    queryOptions({
      queryKey: ["hops"],
      queryFn: () => api<{ hops: HopSummary[] }>("/me/hops").then((r) => r.hops),
    }),

  plan: () => queryOptions({ queryKey: ["plan"], queryFn: () => api<PlanStatus>("/me/plan") }),

  /** Hop+ prices on the website; none where it isn't sold there. */
  prices: () =>
    queryOptions({
      queryKey: ["prices"],
      queryFn: () => api<{ prices: WebPrice[] }>("/billing/web/prices").then((r) => r.prices),
      staleTime: 5 * 60 * 1000,
    }),

  /** An event card's cover: its three newest clips. */
  cover: (hopId: string) =>
    queryOptions({
      queryKey: ["cover", hopId],
      queryFn: () =>
        api<InboxPage>(`/me/files?hopId=${encodeURIComponent(hopId)}&limit=3`).then(
          (page) => page.files,
        ),
    }),

  files: (hopId: string | null) =>
    infiniteQueryOptions({
      queryKey: ["files", hopId],
      initialPageParam: null as string | null,
      queryFn: ({ pageParam }) => {
        const params = new URLSearchParams();
        if (hopId) params.set("hopId", hopId);
        if (pageParam) params.set("cursor", pageParam);
        return api<InboxPage>(`/me/files?${params}`);
      },
      getNextPageParam: (last) => last.nextCursor,
    }),
};
