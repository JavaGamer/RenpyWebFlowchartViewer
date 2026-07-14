import React from "react";
import { cn } from "../utils/cn.ts";

export interface SettingsRowProps {
  label: string;
  description?: string;
  isDark?: boolean;
  children: React.ReactNode;
  className?: string;
}

export function SettingsRow({
  label,
  description,
  isDark = false,
  children,
  className,
}: SettingsRowProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
    >
      <div className="flex flex-col">
        <span
          className={cn(
            "font-medium text-xs",
            isDark ? "text-slate-300" : "text-gray-700",
          )}
        >
          {label}
        </span>
        {description && (
          <span
            className={cn(
              "text-[10px]",
              isDark ? "text-slate-400" : "text-gray-500",
            )}
          >
            {description}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 mt-1 sm:mt-0">{children}</div>
    </div>
  );
}
