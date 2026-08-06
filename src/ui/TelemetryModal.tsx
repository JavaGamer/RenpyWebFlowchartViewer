import React from "react";
import {
  Activity,
  BarChart3,
  FileText,
  GitBranch,
  Timer,
  Zap,
} from "lucide-react";
import { useTelemetryStore } from "../application/index.ts";
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
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  value: string | number | null;
  unit: string;
  accent?: "violet" | "purple" | "fuchsia" | "indigo";
}) {
  const accentRing: Record<string, string> = {
    violet: "ring-violet-500/20",
    purple: "ring-purple-500/20",
    fuchsia: "ring-fuchsia-500/20",
    indigo: "ring-indigo-500/20",
  };
  const accentText: Record<string, string> = {
    violet: "text-violet-400",
    purple: "text-purple-400",
    fuchsia: "text-fuchsia-400",
    indigo: "text-indigo-400",
  };

  return (
    <div
      className={cn(
        "group relative rounded-xl bg-gradient-to-br from-violet-500/10 to-purple-500/10 p-4 ring-1",
        accentRing[accent],
        "transition-all duration-300 hover:scale-[1.03] hover:shadow-lg hover:shadow-violet-500/5",
      )}
    >
      <div className="flex items-center gap-2 mb-2">
        <Icon size={16} className={accentText[accent]} />
        <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">
          {label}
        </span>
      </div>
      {value !== null && value !== ""
        ? (
          <div className="flex items-baseline gap-1.5">
            <span className="text-2xl font-bold text-gray-100 tabular-nums">
              {value}
            </span>
            <span className="text-xs text-gray-500">{unit}</span>
          </div>
        )
        : <span className="text-sm italic text-gray-600">No data yet</span>}
    </div>
  );
}

/* ── Modal ──────────────────────────────────────────────────────────────── */

export default function TelemetryModal({ open, onClose }: TelemetryModalProps) {
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
      isDark
      headerAction={<Activity size={18} className="text-violet-400" />}
      className="bg-gray-900/90 backdrop-blur-xl ring-white/10"
    >
      <div className="h-px bg-gradient-to-r from-transparent via-violet-500/30 to-transparent my-3" />

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
              />
              <MetricCard
                icon={Zap}
                label="Parse Throughput"
                value={parseThroughput}
                unit="nodes / sec"
                accent="purple"
              />
              <MetricCard
                icon={Timer}
                label="Layout Time"
                value={layoutMs != null ? layoutMs.toFixed(1) : null}
                unit="ms"
                accent="fuchsia"
              />
              <MetricCard
                icon={BarChart3}
                label="Render Time"
                value={renderMs != null ? renderMs.toFixed(1) : null}
                unit="ms"
                accent="indigo"
              />
              <MetricCard
                icon={GitBranch}
                label="Nodes"
                value={nodesCount > 0 ? nodesCount : null}
                unit="nodes"
                accent="violet"
              />
              <MetricCard
                icon={GitBranch}
                label="Edges"
                value={edgesCount > 0 ? edgesCount : null}
                unit="edges"
                accent="purple"
              />
            </div>
          )
          : (
            <div className="flex flex-col items-center justify-center py-10 text-gray-600">
              <Activity size={32} className="mb-3 text-gray-700" />
              <p className="text-sm">No data yet</p>
              <p className="text-xs text-gray-700 mt-1 text-center">
                Upload and parse a Ren'Py project to see metrics
              </p>
            </div>
          )}
      </div>

      {/* Footer */}
      <div className="pt-4 flex items-center gap-2 text-[10px] text-gray-600">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500/60" />
        Metrics are captured when debug perf is enabled
      </div>
    </Modal>
  );
}
