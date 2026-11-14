import type { HopSummary, InboxPage, PublicConfig, PublicHop } from "@hop/shared";
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
