import { Loader2 } from "lucide-react";

interface LoadingScreenProps {
  message?: string;
}

export function LoadingScreen({ message = "Loading dispatch data..." }: LoadingScreenProps) {
  return (
    <div className="flex h-full w-full items-center justify-center bg-background">
      <div className="flex max-w-md flex-col items-center gap-4 px-4 text-center">
        <Loader2 className="h-10 w-10 animate-spin text-primary" aria-hidden="true" />
        <div>
          <h2 className="text-lg font-semibold">Halo Dispatch Portal</h2>
          <p className="mt-1 text-sm text-muted-foreground">{message}</p>
        </div>
      </div>
    </div>
  );
}
