import React from "react";
import { cn } from "../utils/cn.ts";

interface UrlImportFormProps {
  isDark: boolean;
  importUrl: string;
  setImportUrl: (url: string) => void;
  isFetchingUrl: boolean;
  urlError: string | null;
  handleUrlSubmit: (e: React.FormEvent) => void;
}

export function UrlImportForm({
  isDark,
  importUrl,
  setImportUrl,
  isFetchingUrl,
  urlError,
  handleUrlSubmit,
}: UrlImportFormProps) {
  return (
    <div
      className={cn(
        "mt-4 border rounded-xl p-4 shadow-sm text-xs transition-colors duration-200",
        isDark
          ? "border-slate-800 bg-slate-900 text-slate-300"
          : "border-gray-200 bg-white text-gray-700",
      )}
    >
      <h3
        className={cn(
          "font-semibold mb-2",
          isDark ? "text-slate-100" : "text-gray-900",
        )}
      >
        Or Import from Public URL
      </h3>
      <form onSubmit={handleUrlSubmit} className="flex gap-2">
        <input
          type="text"
          required
          disabled={isFetchingUrl}
          placeholder="Enter .rpy file, .zip URL, or GitHub repo (e.g., github.com/owner/repo)"
          value={importUrl}
          onChange={(e) => setImportUrl(e.target.value)}
          className={cn(
            "flex-1 rounded-md border px-3 py-1.5 focus:outline-none focus:ring-1 text-xs transition-colors duration-200",
            isDark
              ? "border-slate-700 bg-slate-800 text-slate-100 placeholder-slate-500 focus:ring-violet-400"
              : "border-gray-300 bg-white text-gray-900 placeholder-gray-400 focus:ring-violet-500",
          )}
        />
        <button
          type="submit"
          disabled={isFetchingUrl}
          className={cn(
            "rounded-md px-3 py-1.5 text-white font-semibold transition-colors focus:outline-none focus-visible:ring-2",
            isDark
              ? "bg-violet-600 hover:bg-violet-500 focus-visible:ring-violet-400 disabled:bg-violet-800"
              : "bg-violet-600 hover:bg-violet-700 focus-visible:ring-violet-500 disabled:bg-violet-400",
          )}
        >
          {isFetchingUrl ? "Loading..." : "Import"}
        </button>
      </form>
      {urlError && (
        <p
          className="mt-2 text-[11px] text-red-600 font-semibold"
          role="alert"
        >
          {urlError}
        </p>
      )}
      <p
        className={cn(
          "mt-2 text-[10px]",
          isDark ? "text-slate-500" : "text-gray-400",
        )}
      >
        Note: Remote hosts must support CORS. GitHub repositories and
        raw.githubusercontent.com files are fully supported.
      </p>
    </div>
  );
}
