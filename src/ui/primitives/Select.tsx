import { cn } from "../utils/cn.ts";
import { CONTROL_INPUT_CLASS } from "../viewerConstants.ts";

export interface SelectOption<T extends string | number = string> {
  value: T;
  label: string;
}

export interface SelectProps<T extends string | number = string> {
  value: T;
  onChange: (value: T) => void;
  options: SelectOption<T>[];
  isDark?: boolean;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
}

export function Select<T extends string | number = string>({
  value,
  onChange,
  options,
  isDark = false,
  disabled = false,
  className,
  "aria-label": ariaLabel,
}: SelectProps<T>) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as unknown as T)}
      disabled={disabled}
      className={cn(
        CONTROL_INPUT_CLASS,
        isDark
          ? "bg-slate-800 border-slate-700 text-slate-200"
          : "bg-white border-gray-300 text-gray-700",
        className,
      )}
      aria-label={ariaLabel}
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}
