

import { useState } from 'react';
import { FolderOpen, Activity } from 'lucide-react';
import TelemetryModal from './TelemetryModal';
import { useViewerStore } from '../application';
import type { ThemeName } from '../domain';
import { cn } from './utils/cn';

export default function Header() {
  const [telemetryOpen, setTelemetryOpen] = useState(false);
  const theme = useViewerStore((s) => s.theme);
  const setTheme = useViewerStore((s) => s.setTheme);
  const isDark = theme === 'dark';

  return (
    <>
      <header className={cn(
        "shrink-0 border-b px-4 sm:px-6 py-4 flex flex-wrap items-center justify-between gap-3 shadow-sm transition-colors duration-200",
        isDark
          ? "bg-slate-900 border-slate-800 text-slate-100"
          : "bg-white border-gray-200 text-gray-900"
      )}>
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 bg-violet-600 rounded-lg flex items-center justify-center shrink-0">
            <FolderOpen size={16} className="text-white" />
          </div>
          <div>
            <h1 className={cn("text-base sm:text-lg font-bold tracking-tight truncate", isDark ? "text-slate-100" : "text-gray-900")}>
              Ren'Py Flowchart Viewer
            </h1>
            <p className={cn("hidden sm:block text-[11px] mt-0.5", isDark ? "text-slate-400" : "text-gray-500")}>
              Visualize script structure, search dialogue, and export flowcharts locally in your browser.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <label htmlFor="header-theme-select" className="sr-only">Theme</label>
          <select
            id="header-theme-select"
            value={theme}
            onChange={(e) => setTheme(e.target.value as ThemeName)}
            className={cn(
              "rounded-lg border px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-violet-500 cursor-pointer transition-colors duration-200",
              isDark
                ? "bg-slate-800 border-slate-700 text-slate-100 focus:ring-violet-400"
                : "bg-gray-50 border-gray-200 text-gray-700"
            )}
          >
            <option value="violet">Default Theme</option>
            <option value="highContrast">High Contrast</option>
            <option value="colorblind">Colorblind Friendly</option>
            <option value="dark">Dark Theme</option>
          </select>

          <button
            onClick={() => setTelemetryOpen(true)}
            className={cn(
              "rounded-lg p-1.5 transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500",
              isDark
                ? "text-slate-400 hover:bg-slate-800 hover:text-violet-400"
                : "text-gray-400 hover:bg-violet-50 hover:text-violet-600"
            )}
            aria-label="Performance stats"
            title="Performance stats"
          >
            <Activity size={16} />
          </button>
        </div>

        <span className={cn("sm:hidden w-full text-xs text-center py-1 border-t mt-1", isDark ? "text-slate-400 border-slate-800" : "text-gray-600 border-gray-100")}>
          Upload a Ren'Py project folder to visualize script structure, search dialogue, and export flowcharts
        </span>
      </header>

      <TelemetryModal open={telemetryOpen} onClose={() => setTelemetryOpen(false)} />
    </>
  );
}

