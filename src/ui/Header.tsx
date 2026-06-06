

import { FolderOpen } from 'lucide-react';

export default function Header() {
  return (
    <header className="shrink-0 bg-white border-b border-gray-200 px-4 sm:px-6 py-4 flex flex-wrap items-center gap-2 sm:gap-3 shadow-sm">
      <div className="flex items-center gap-2 min-w-0">
        <div className="w-8 h-8 bg-violet-600 rounded-lg flex items-center justify-center">
          <FolderOpen size={16} className="text-white" />
        </div>
        <h1 className="text-base sm:text-lg font-bold text-gray-900 tracking-tight truncate">
          Ren'Py Flowchart Viewer
        </h1>
      </div>
      <span className="w-full sm:w-auto text-xs text-gray-700 sm:ml-2 text-center sm:text-left">
        Upload a Ren'Py project folder to visualize script structure, search dialogue, and export flowcharts
      </span>
    </header>
  );
}
