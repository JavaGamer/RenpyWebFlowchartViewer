import {
  LayoutGrid,
  LocateFixed,
  Palette,
  SlidersHorizontal,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import type {
  CanvasNode,
  LayoutDensity,
  LayoutDirection,
  ThemeName,
} from "../../domain/index.ts";
import { useViewerStore } from "../../application/index.ts";
import { cn } from "../utils/cn.ts";
import { Button, SectionHeader, Select } from "../primitives/index.ts";

export interface LayoutSettingsProps {
  onRelayout: () => void;
  onFocusSelectedNode: () => void;
  focusTargetNode: CanvasNode | undefined;
  labels: string[];
}

export function LayoutSettings({
  onRelayout,
  onFocusSelectedNode,
  focusTargetNode,
  labels,
}: LayoutSettingsProps) {
  const {
    layoutDirection,
    layoutDensity,
    theme,
    focusNodeId,
    setLayoutDirection,
    setLayoutDensity,
    setTheme,
    setFocusNodeId,
  } = useViewerStore(
    useShallow((s) => ({
      layoutDirection: s.layoutDirection,
      layoutDensity: s.layoutDensity,
      theme: s.theme,
      focusNodeId: s.focusNodeId,
      setLayoutDirection: s.setLayoutDirection,
      setLayoutDensity: s.setLayoutDensity,
      setTheme: s.setTheme,
      setFocusNodeId: s.setFocusNodeId,
    })),
  );

  const isDark = theme === "dark";

  const directionOptions = [
    { value: "TB", label: "Top-Bottom" },
    { value: "LR", label: "Left-Right" },
  ];

  const densityOptions = [
    { value: "compact", label: "Compact" },
    { value: "normal", label: "Normal" },
    { value: "spacious", label: "Spacious" },
  ];

  const themeOptions = [
    { value: "violet", label: "Default" },
    { value: "highContrast", label: "Contrast" },
    { value: "colorblind", label: "Colorblind" },
    { value: "dark", label: "Dark Mode" },
  ];

  const focusLabelOptions = [
    { value: "", label: "Select label" },
    ...labels.map((l) => ({ value: l, label: l })),
  ];

  return (
    <div
      className="flex flex-col gap-2"
      role="group"
      aria-label="Layout and focus controls"
    >
      <SectionHeader title="Layout & Focus" isDark={isDark} />
      <div
        className={cn(
          "grid grid-cols-3 gap-2 p-3 rounded-lg border",
          isDark
            ? "bg-slate-800/40 border-slate-700/60"
            : "bg-gray-50/50 border-gray-100",
        )}
      >
        {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
        <label
          className={cn(
            "text-xs flex flex-col gap-1 font-medium",
            isDark ? "text-slate-300" : "text-gray-700",
          )}
        >
          <span
            className={cn(
              "flex items-center gap-1",
              isDark ? "text-slate-400" : "text-gray-600",
            )}
          >
            <LayoutGrid size={13} aria-hidden="true" />
            Direction
          </span>
          <Select
            value={layoutDirection}
            onChange={(val) => setLayoutDirection(val as LayoutDirection)}
            options={directionOptions}
            isDark={isDark}
            aria-label="Auto layout direction"
          />
        </label>
        {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
        <label
          className={cn(
            "text-xs flex flex-col gap-1 font-medium",
            isDark ? "text-slate-300" : "text-gray-700",
          )}
        >
          <span
            className={cn(
              "flex items-center gap-1",
              isDark ? "text-slate-400" : "text-gray-600",
            )}
          >
            <SlidersHorizontal size={13} aria-hidden="true" />
            Density
          </span>
          <Select
            value={layoutDensity}
            onChange={(val) => setLayoutDensity(val as LayoutDensity)}
            options={densityOptions}
            isDark={isDark}
            aria-label="Layout density"
          />
        </label>
        {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
        <label
          className={cn(
            "text-xs flex flex-col gap-1 font-medium",
            isDark ? "text-slate-300" : "text-gray-700",
          )}
        >
          <span
            className={cn(
              "flex items-center gap-1",
              isDark ? "text-slate-400" : "text-gray-600",
            )}
          >
            <Palette size={13} aria-hidden="true" />
            Theme
          </span>
          <Select
            value={theme}
            onChange={(val) => setTheme(val as ThemeName)}
            options={themeOptions}
            isDark={isDark}
            aria-label="Color theme"
          />
        </label>
        {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
        <label
          className={cn(
            "text-xs flex flex-col gap-1 font-medium col-span-3",
            isDark ? "text-slate-300" : "text-gray-700",
          )}
        >
          Focus label
          <div className="flex gap-2">
            <Select
              value={focusNodeId}
              onChange={setFocusNodeId}
              options={focusLabelOptions}
              isDark={isDark}
              className="flex-1 min-w-0"
              aria-label="Focus label"
            />
            <Button
              type="button"
              onClick={onFocusSelectedNode}
              disabled={!focusNodeId}
              isDark={isDark}
              className="px-3 py-1 cursor-pointer"
              aria-label="Center selected label"
            >
              <LocateFixed
                size={12}
                className="inline mr-1"
                aria-hidden="true"
              />
              Center
            </Button>
          </div>
        </label>
        <div className="col-span-3 flex justify-between items-center pt-1">
          <Button
            onClick={onRelayout}
            isDark={isDark}
            className="px-3 py-1 cursor-pointer"
            aria-label="Re-run auto layout"
          >
            Re-run layout
          </Button>
          <span
            className={cn(
              "text-[11px]",
              isDark ? "text-slate-400" : "text-gray-500",
            )}
            aria-live="off"
          >
            {!focusNodeId
              ? "Select a label, then center it."
              : focusTargetNode
              ? `Ready to center: ${focusNodeId}`
              : `${focusNodeId} is hidden by filters.`}
          </span>
        </div>
      </div>
    </div>
  );
}
