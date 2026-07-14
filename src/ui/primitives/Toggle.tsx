import { cn } from "../utils/cn.ts";

export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  title?: string;
  isDark?: boolean;
  disabled?: boolean;
}

export function Toggle({
  checked,
  onChange,
  label,
  title,
  isDark = false,
  disabled = false,
}: ToggleProps) {
  return (
    <label
      className={cn(
        "inline-flex items-center gap-2 cursor-pointer select-none",
        disabled && "opacity-50 cursor-not-allowed",
      )}
      title={title}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => !disabled && onChange(e.target.checked)}
        disabled={disabled}
        className="rounded text-violet-600 focus:ring-violet-500 w-4 h-4 cursor-pointer disabled:cursor-not-allowed"
        aria-label={label}
      />
      <span
        className={cn(
          "font-medium",
          isDark ? "text-slate-300" : "text-gray-700",
        )}
      >
        {label}
      </span>
    </label>
  );
}
