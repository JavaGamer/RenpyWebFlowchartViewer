import React from "react";
import {
  Activity,
  BarChart3,
  FileText,
  GitBranch,
  Timer,
  Zap,
} from "lucide-react";
import { useTelemetryStore, useViewerStore } from "../application/index.ts";
import { cn } from "./utils/cn.ts";
import { Modal } from "./primitives/index.ts";

interface TelemetryModalProps {
  open: boolean;
  onClose: () => void;
}

/* ── Metric card ────────────────────────────────────────────────────────── */

function MetricCard({
  icon: Icon,
  label,
  value,
  unit,
  accent = "violet",
  isDark,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  value: string | number | null;
  unit: string;
  accent?: "violet" | "purple" | "fuchsia" | "indigo";
  isDark: boolean;
}) {
  const accentRingDark: Record<string, string> = {
    violet: "ring-violet-500/20",
    purple: "ring-purple-500/20",
    fuchsia: "ring-fuchsia-500/20",
    indigo: "ring-indigo-500/20",
  };
  const accentText: Record<string, string> = {
    violet: isDark ? "text-violet-400" : "text-violet-600",
    purple: isDark ? "text-purple-400" : "text-purple-600",
    fuchsia: isDark ? "text-fuchsia-400" : "text-fuchsia-600",
    indigo: isDark ? "text-indigo-400" : "text-indigo-600",
  };

  return (
    <div
      className={cn(
        "group relative rounded-xl p-4 ring-1 transition-all duration-300 hover:scale-[1.03] hover:shadow-lg",
        isDark
          ? cn(
            "bg-gradient-to-br from-violet-500/10 to-purple-500/10 hover:shadow-violet-500/5",
            accentRingDark[accent],
          )
          : "bg-gradient-to-br from-violet-50 to-purple-50 hover:shadow-violet-500/10 ring-violet-200",
      )}
    >
      <div className="flex items-center gap-2 mb-2">
        <Icon size={16} className={accentText[accent]} />
        <span
          className={cn(
            "text-xs font-medium uppercase tracking-wider",
            isDark ? "text-slate-400" : "text-gray-500",
          )}
        >
          {label}
        </span>
      </div>
      {value !== null && value !== ""
        ? (
          <div className="flex items-baseline gap-1.5">
            <span
              className={cn(
                "text-2xl font-bold tabular-nums",
                isDark ? "text-slate-100" : "text-gray-900",
              )}
            >
              {value}
            </span>
            <span
              className={cn(
                "text-xs",
                isDark ? "text-slate-400" : "text-gray-500",
              )}
            >
              {unit}
            </span>
          </div>
        )
        : (
          <span
            className={cn(
              "text-sm italic",
              isDark ? "text-slate-500" : "text-gray-400",
            )}
          >
            No data yet
          </span>
        )}
    </div>
  );
}

/* ── Modal ──────────────────────────────────────────────────────────────── */

export default function TelemetryModal({ open, onClose }: TelemetryModalProps) {
  const theme = useViewerStore((s) => s.theme);
  const isDark = theme === "dark";

  const {
    readMs,
    parseMs,
    layoutMs,
    renderMs,
    nodesCount,
    edgesCount,
    fileCount,
  } = useTelemetryStore();

  /* ── Computed values ───────────────────────────────────────────────── */
  const readSpeed = readMs != null && readMs > 0 && fileCount > 0
    ? ((fileCount / readMs) * 1000).toFixed(1)
    : null;

  const parseThroughput = parseMs != null && parseMs > 0 && nodesCount > 0
    ? ((nodesCount / parseMs) * 1000).toFixed(0)
    : null;

  const hasAnyData = readMs != null || parseMs != null || layoutMs != null ||
    renderMs != null || nodesCount > 0;

  return (
    <Modal
      open={open}
      onOpenChange={(val) => {
        if (!val) onClose();
      }}
      title="Performance Telemetry"
      description="Performance throughput and timing statistics of the Ren'Py flowchart parser."
      isDark={isDark}
      headerAction={
        <Activity
          size={18}
          className={isDark ? "text-violet-400" : "text-violet-600"}
        />
      }
      className={isDark
        ? "bg-gray-900/90 backdrop-blur-xl ring-white/10"
        : "bg-white/95 backdrop-blur-xl ring-black/5"}
    >
      <div
        className={cn(
          "h-px my-3",
          isDark
            ? "bg-gradient-to-r from-transparent via-violet-500/30 to-transparent"
            : "bg-gradient-to-r from-transparent via-violet-300 to-transparent",
        )}
      />

      {/* Body */}
      <div className="py-2">
        {hasAnyData
          ? (
            <div className="grid grid-cols-2 gap-3">
              <MetricCard
                icon={FileText}
                label="Read Speed"
                value={readSpeed}
                unit="files / sec"
                accent="violet"
                isDark={isDark}
              />
              <MetricCard
                icon={Zap}
                label="Parse Throughput"
                value={parseThroughput}
                unit="nodes / sec"
                accent="purple"
                isDark={isDark}
              />
              <MetricCard
                icon={Timer}
                label="Layout Time"
                value={layoutMs != null ? layoutMs.toFixed(1) : null}
                unit="ms"
                accent="fuchsia"
                isDark={isDark}
              />
              <MetricCard
                icon={BarChart3}
                label="Render Time"
                value={renderMs != null ? renderMs.toFixed(1) : null}
                unit="ms"
                accent="indigo"
                isDark={isDark}
              />
              <MetricCard
                icon={GitBranch}
                label="Nodes"
                value={nodesCount > 0 ? nodesCount : null}
                unit="nodes"
                accent="violet"
                isDark={isDark}
              />
              <MetricCard
                icon={GitBranch}
                label="Edges"
                value={edgesCount > 0 ? edgesCount : null}
                unit="edges"
                accent="purple"
                isDark={isDark}
              />
            </div>
          )
          : (
            <div
              className={cn(
                "flex flex-col items-center justify-center py-10",
                isDark ? "text-slate-500" : "text-gray-500",
              )}
            >
              <Activity
                size={32}
                className={cn(
                  "mb-3",
                  isDark ? "text-slate-600" : "text-gray-400",
                )}
              />
              <p className="text-sm font-medium">No data yet</p>
              <p
                className={cn(
                  "text-xs mt-1 text-center",
                  isDark ? "text-slate-500" : "text-gray-400",
                )}
              >
                Upload and parse a Ren'Py project to see metrics
              </p>
            </div>
          )}
      </div>

      {/* Footer */}
      <div
        className={cn(
          "pt-4 flex items-center gap-2 text-[10px]",
          isDark ? "text-slate-500" : "text-gray-500",
        )}
      >
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500" />
        Metrics are captured when debug perf is enabled
      </div>
    </Modal>
  );
}
