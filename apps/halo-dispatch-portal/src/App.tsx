import { Suspense, lazy } from "react";
import { BifrostHeader } from "bifrost";

import { ApiErrorPage } from "@/components/ApiErrorPage";
import { CacheRefreshOverlay } from "@/components/CacheRefreshOverlay";
import { HaloWorkflowBridge } from "@/components/HaloWorkflowBridge";
import { LoadingScreen } from "@/components/LoadingScreen";
import { Toaster } from "@/components/ui/sonner";
import { DragProvider } from "@/contexts/DragContext";
import { ThemeProvider } from "@/contexts/ThemeContext";

const DispatchView = lazy(() =>
  import("@/components/DispatchView").then((module) => ({ default: module.DispatchView })),
);

export default function App() {
  return (
    <ThemeProvider>
      <HaloWorkflowBridge>
        <DragProvider>
          <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
            <BifrostHeader title="Halo Dispatch Portal" />
            <main className="relative min-h-0 flex-1 overflow-hidden">
              <ApiErrorPage />
              <CacheRefreshOverlay />
              <Suspense fallback={<LoadingScreen />}>
                <DispatchView />
              </Suspense>
            </main>
            <Toaster />
          </div>
        </DragProvider>
      </HaloWorkflowBridge>
    </ThemeProvider>
  );
}
