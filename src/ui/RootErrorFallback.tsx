export function RootErrorFallback({ error }: { error: unknown }) {
  return (
    <div
      role="alert"
      className="min-h-screen flex flex-col items-center justify-center gap-4 p-8 text-center bg-white"
    >
      <h1 className="text-xl font-semibold text-red-700">Something went wrong</h1>
      <p className="text-sm text-gray-600 max-w-lg">
        An unexpected error occurred. Refreshing the page may resolve the issue.
      </p>
      {error instanceof Error && (
        <pre className="text-xs text-left bg-gray-100 rounded p-3 max-w-lg overflow-auto">
          {error.message}
        </pre>
      )}
    </div>
  );
}

export default RootErrorFallback;
