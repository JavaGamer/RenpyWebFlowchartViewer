import { cn } from "../utils/cn.ts";

export interface SectionHeaderProps {
  title: string;
  isDark?: boolean;
}

export function SectionHeader({ title, isDark = false }: SectionHeaderProps) {
  return (
    <h3
      className={cn(
        "text-[11px] font-bold uppercase tracking-wider",
        isDark ? "text-slate-400" : "text-gray-500",
      )}
    >
      {title}
    </h3>
  );
}
