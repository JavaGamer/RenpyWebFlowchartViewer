import { CONTROL_BUTTON_CLASS } from "./viewerConstants";

interface CanvasErrorFallbackProps {
  error: unknown;
  resetErrorBoundary: () => void;
}

export function CanvasErrorFallback({
  error,
  resetErrorBoundary,
}: CanvasErrorFallbackProps) {
  return (
    <div
      role="alert"
      className="flex-1 flex flex-col items-center justify-center gap-4 p-8 text-center min-h-[320px]"
    >
      <p className="text-sm font-medium text-red-700">
        The chart view encountered an error.
      </p>
      {error instanceof Error && (
        <pre className="text-xs text-left bg-gray-100 rounded p-3 max-w-md overflow-auto">
          {error.message}
        </pre>
      )}
      <button
        type="button"
        className={CONTROL_BUTTON_CLASS}
        onClick={resetErrorBoundary}
      >
        Try again
      </button>
    </div>
  );
}
