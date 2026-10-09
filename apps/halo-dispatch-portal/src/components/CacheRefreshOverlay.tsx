import { Loader2 } from "lucide-react";

import { useDispatchStore } from "@/stores/useDispatchStore";

const LABELS: Record<string, string> = {
  all: "reference data",
  agents: "agents",
  teams: "teams",
  ticket_areas: "ticket areas",
  ticket_types: "ticket types",
  statuses: "statuses",
  view_lists: "view lists",
  categories: "categories",
  appointment_types: "appointment types",
};

export function CacheRefreshOverlay() {
  const cacheRefreshType = useDispatchStore((state) => state.cacheRefreshType);
  if (!cacheRefreshType) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-background/95"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="cache-refresh-title"
    >
      <div className="flex flex-col items-center gap-4 px-6 text-center">
        <Loader2 className="h-10 w-10 animate-spin text-primary" aria-hidden="true" />
        <div>
          <h2 id="cache-refresh-title" className="text-lg font-semibold">
            Refreshing cache... Please wait
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Updating {LABELS[cacheRefreshType] ?? cacheRefreshType}
          </p>
        </div>
      </div>
    </div>
  );
}
