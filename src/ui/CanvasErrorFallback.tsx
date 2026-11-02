import { useViewerStore } from "../application/index.ts";
import { cn } from "./utils/cn.ts";

interface CanvasErrorFallbackProps {
  error: unknown;
  resetErrorBoundary: () => void;
}

export function CanvasErrorFallback({
  error,
  resetErrorBoundary,
}: CanvasErrorFallbackProps) {
  const theme = useViewerStore((s) => s.theme);
  const isDark = theme === "dark";

  return (
    <div
      role="alert"
      className="flex-1 flex flex-col items-center justify-center gap-4 p-8 text-center min-h-[320px]"
    >
      <p
        className={cn(
          "text-sm font-medium",
          isDark ? "text-rose-400" : "text-red-700",
        )}
      >
        The chart view encountered an error.
      </p>
      {error instanceof Error && (
        <pre
          className={cn(
            "text-xs text-left rounded p-3 max-w-md overflow-auto border font-mono",
            isDark
              ? "bg-slate-900 border-slate-700 text-slate-200"
              : "bg-gray-100 border-gray-200 text-gray-800",
          )}
        >
          {error.message}
        </pre>
      )}
      <button
        type="button"
        className={cn(
          "px-3 py-1.5 text-xs font-medium rounded-md border transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500",
          isDark
            ? "bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700"
            : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50",
        )}
        onClick={resetErrorBoundary}
      >
        Try again
      </button>
    </div>
  );
}
