import { useState } from "react";
import { AlertTriangle, ChevronDown } from "lucide-react";
import type { ParseDiagnosticPayload } from "../infrastructure/index.ts";
import { cn } from "./utils/cn.ts";
import { useViewerStore } from "../application/index.ts";

export interface DiagnosticsSectionProps {
  parseDiagnostics: ParseDiagnosticPayload[];
}

export default function DiagnosticsSection(
  { parseDiagnostics }: DiagnosticsSectionProps,
) {
  const [isCollapsed, setIsCollapsed] = useState(true);
  const theme = useViewerStore((s) => s.theme);
  const isDark = theme === "dark";

  if (parseDiagnostics.length === 0) return null;

  return (
    <section
      className={cn(
        "shrink-0 border-b px-4 py-2 transition-colors duration-200",
        isDark
          ? "border-amber-900/60 bg-amber-950/40 text-amber-200"
          : "border-amber-200 bg-amber-50 text-amber-900",
      )}
      aria-label="Parser warnings"
    >
      <button
        onClick={() => setIsCollapsed(!isCollapsed)}
        className={cn(
          "w-full flex items-center justify-between text-left focus:outline-none focus-visible:ring-2 rounded px-1 py-1",
          isDark
            ? "focus-visible:ring-amber-400"
            : "focus-visible:ring-amber-500",
        )}
        aria-expanded={!isCollapsed}
        aria-controls="diagnostics-list"
      >
        <div className="flex items-center gap-2">
          <AlertTriangle
            size={15}
            className={cn(
              "shrink-0",
              isDark ? "text-amber-400" : "text-amber-600",
            )}
          />
          <span className="text-sm font-semibold">
            Parser Warnings
          </span>
          <span
            className={cn(
              "text-xs font-semibold rounded-full px-2 py-0.5",
              isDark
                ? "bg-amber-900/60 text-amber-200"
                : "bg-amber-200/60 text-amber-950",
            )}
          >
            {parseDiagnostics.length}
          </span>
        </div>
        <ChevronDown
          size={16}
          className={cn(
            "transition-transform duration-200",
            isDark ? "text-amber-400" : "text-amber-700",
            isCollapsed ? "" : "rotate-180",
          )}
          aria-hidden="true"
        />
      </button>

      {!isCollapsed && (
        <ul
          id="diagnostics-list"
          className={cn(
            "mt-2 list-disc pl-5 text-xs space-y-1 border-t pt-2 animate-in fade-in slide-in-from-top-1 duration-200",
            isDark ? "border-amber-900/40" : "border-amber-200/40",
          )}
        >
          {parseDiagnostics.map((warning, idx) => (
            <li key={`${warning.code}-${warning.message}-${idx}`}>
              <span className="font-medium uppercase">
                {warning.context?.category
                  ? warning.context.category.replace(/_/g, " ")
                  : warning.code}
              </span>
              {warning.location?.construct
                ? (
                  <>
                    {" "}
                    ·{" "}
                    <span className="font-medium">
                      {warning.location.construct}
                    </span>
                  </>
                )
                : null}
              {warning.location?.chapter
                ? (
                  <>
                    {" "}
                    in{" "}
                    <span className="font-medium">
                      {warning.location.chapter}
                    </span>
                  </>
                )
                : null}
              : {warning.message}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
