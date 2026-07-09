import { useShallow } from "zustand/react/shallow";
import { useViewerStore } from "../../application/index.ts";
import { cn } from "../utils/cn.ts";

/** Min/max WPM bounds exposed to the UI. */
const MIN_WPM = 100;
const MAX_WPM = 400;
const WPM_STEP = 10;

export function ReadingSettings() {
  const { theme, readingSpeedWpm, setReadingSpeedWpm } = useViewerStore(
    useShallow((s) => ({
      theme: s.theme,
      readingSpeedWpm: s.readingSpeedWpm,
      setReadingSpeedWpm: s.setReadingSpeedWpm,
    })),
  );

  const isDark = theme === "dark";

  return (
    <div
      className="flex flex-col gap-2"
      role="group"
      aria-label="Reading time settings"
    >
      <h3
        className={cn(
          "text-[11px] font-bold uppercase tracking-wider",
          isDark ? "text-slate-500" : "text-gray-400",
        )}
      >
        Reading Time
      </h3>
      <div
        className={cn(
          "flex flex-col gap-3.5 p-3 rounded-lg border text-xs",
          isDark
            ? "bg-slate-800/40 border-slate-700/60"
            : "bg-gray-50/50 border-gray-100",
        )}
      >
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <label
              htmlFor="reading-speed-wpm"
              className={cn(
                "font-medium",
                isDark ? "text-slate-350" : "text-gray-700",
              )}
            >
              Reading speed
            </label>
            <span
              className={cn(
                "font-mono font-semibold text-[11px] tabular-nums",
                isDark ? "text-violet-300" : "text-violet-700",
              )}
            >
              {readingSpeedWpm} WPM
            </span>
          </div>
          <input
            id="reading-speed-wpm"
            type="range"
            min={MIN_WPM}
            max={MAX_WPM}
            step={WPM_STEP}
            value={readingSpeedWpm}
            onChange={(e) => setReadingSpeedWpm(Number(e.target.value))}
            className="w-full accent-violet-500 cursor-pointer"
            aria-label={`Reading speed: ${readingSpeedWpm} words per minute`}
            aria-valuemin={MIN_WPM}
            aria-valuemax={MAX_WPM}
            aria-valuenow={readingSpeedWpm}
          />
          <div
            className={cn(
              "flex justify-between text-[10px]",
              isDark ? "text-slate-500" : "text-gray-400",
            )}
          >
            <span>{MIN_WPM} WPM</span>
            <span className={cn(isDark ? "text-slate-500" : "text-gray-400")}>
              Affects reading time on node cards, inspector, toolbar &amp; chapters
            </span>
            <span>{MAX_WPM} WPM</span>
          </div>
        </div>
      </div>
    </div>
  );
}
