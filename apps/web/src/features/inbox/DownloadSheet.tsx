import type { InboxFile } from "@hop/shared";
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { buttonClass } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import { downloadUrls } from "../../lib/download";
import { formatBytes } from "../../lib/format";
import { ContributorLabel } from "./ContributorLabel";

/**
 * Where a zip can't be streamed to disk (Safari, Firefox, iOS), each file gets
 * its own link: browsers block scripted multi-file downloads.
 */
export function DownloadSheet({
  files,
  onClose,
}: {
  files: InboxFile[] | null;
  onClose: () => void;
}) {
  const ids = files?.map((f) => f.id) ?? [];
  const urls = useQuery({
    queryKey: ["download-urls", ids],
    queryFn: () => downloadUrls(ids),
    enabled: ids.length > 0,
    staleTime: 10 * 60_000,
  });

  return (
    <Dialog
      open={files !== null}
      onClose={onClose}
      title={`Download ${ids.length} ${ids.length === 1 ? "file" : "files"}`}
      description="This browser saves files one at a time. Chrome or Edge on a computer can download everything as one zip."
    >
      <ul className="-mx-2 divide-y divide-line">
        {files?.map((file) => {
          const url = urls.data?.get(file.id);
          return (
            <li key={file.id} className="flex items-center gap-3 px-2 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-medium">{file.name}</p>
                <p className="flex min-w-0 gap-1 text-xs text-muted">
                  <ContributorLabel file={file} /> · {formatBytes(file.size)}
                </p>
              </div>
              {url ? (
                <a className={buttonClass({ variant: "soft", size: "sm" })} href={url}>
                  <Download className="size-4" /> Save
                </a>
              ) : (
                <span className="skeleton h-9 w-20 rounded-full" />
              )}
            </li>
          );
        })}
      </ul>
    </Dialog>
  );
}
