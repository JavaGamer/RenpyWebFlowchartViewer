

import { useState } from 'react';
import { FolderOpen, Activity } from 'lucide-react';
import TelemetryModal from './TelemetryModal';

export default function Header() {
  const [telemetryOpen, setTelemetryOpen] = useState(false);

  return (
    <>
      <header className="shrink-0 bg-white border-b border-gray-200 px-4 sm:px-6 py-4 flex flex-wrap items-center gap-2 sm:gap-3 shadow-sm">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 bg-violet-600 rounded-lg flex items-center justify-center">
            <FolderOpen size={16} className="text-white" />
          </div>
          <h1 className="text-base sm:text-lg font-bold text-gray-900 tracking-tight truncate">
            Ren'Py Flowchart Viewer
          </h1>
        </div>
        <button
          onClick={() => setTelemetryOpen(true)}
          className={
            'ml-1 rounded-lg p-1.5 text-gray-400 ' +
            'hover:bg-violet-50 hover:text-violet-600 ' +
            'transition-colors duration-200 ' +
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500'
          }
          aria-label="Performance stats"
          title="Performance stats"
        >
          <Activity size={16} />
        </button>
        <span className="w-full sm:w-auto text-xs text-gray-700 sm:ml-2 text-center sm:text-left">
          Upload a Ren'Py project folder to visualize script structure, search dialogue, and export flowcharts
        </span>
      </header>

      <TelemetryModal open={telemetryOpen} onClose={() => setTelemetryOpen(false)} />
    </>
  );
}

