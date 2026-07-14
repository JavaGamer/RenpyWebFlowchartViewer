import React from "react";
import { cn } from "../utils/cn.ts";
import { CONTROL_BUTTON_CLASS, PRIMARY_BUTTON_CLASS } from "../viewerConstants.ts";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost";
  isDark?: boolean;
  children?: React.ReactNode;
}

export function Button({
  variant = "secondary",
  isDark = false,
  children,
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        variant === "primary" && PRIMARY_BUTTON_CLASS,
        variant === "secondary" && CONTROL_BUTTON_CLASS,
        variant === "ghost" && "px-2 py-1 rounded transition-colors text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500",
        variant === "primary" && (isDark
          ? "bg-violet-700 hover:bg-violet-600 text-white"
          : "bg-violet-600 hover:bg-violet-700 text-white"),
        variant === "secondary" && (isDark
          ? "bg-slate-800 border-slate-700 hover:bg-slate-700 text-slate-200"
          : "bg-white border-gray-300 hover:bg-gray-50 text-gray-700"),
        variant === "ghost" && (isDark
          ? "hover:bg-slate-800 text-slate-300 hover:text-white"
          : "hover:bg-gray-100 text-gray-600 hover:text-gray-900"),
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
