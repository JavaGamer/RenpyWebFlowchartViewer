

import { useState } from 'react';
import { AlertTriangle, ChevronDown } from 'lucide-react';
import type { ParseDiagnosticPayload } from '../infrastructure';

export interface DiagnosticsSectionProps {
  parseDiagnostics: ParseDiagnosticPayload[];
}

export default function DiagnosticsSection({ parseDiagnostics }: DiagnosticsSectionProps) {
  const [isCollapsed, setIsCollapsed] = useState(true);

  if (parseDiagnostics.length === 0) return null;

  return (
    <section
      className="shrink-0 border-b border-amber-200 bg-amber-50 px-4 py-2 text-amber-900"
      aria-label="Parser warnings"
    >
      <button
        onClick={() => setIsCollapsed(!isCollapsed)}
        className="w-full flex items-center justify-between text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 rounded px-1 py-1"
        aria-expanded={!isCollapsed}
        aria-controls="diagnostics-list"
      >
        <div className="flex items-center gap-2">
          <AlertTriangle size={15} className="text-amber-600 shrink-0" />
          <span className="text-sm font-semibold">
            Parser Warnings
          </span>
          <span className="text-xs font-semibold rounded-full bg-amber-200/60 text-amber-950 px-2 py-0.5">
            {parseDiagnostics.length}
          </span>
        </div>
        <ChevronDown
          size={16}
          className={`text-amber-700 transition-transform duration-200 ${
            isCollapsed ? '' : 'rotate-180'
          }`}
          aria-hidden="true"
        />
      </button>

      {!isCollapsed && (
        <ul
          id="diagnostics-list"
          className="mt-2 list-disc pl-5 text-xs space-y-1 border-t border-amber-200/40 pt-2 animate-in fade-in slide-in-from-top-1 duration-200"
        >
          {parseDiagnostics.map((warning, idx) => (
            <li key={`${warning.code}-${warning.message}-${idx}`}>
              <span className="font-medium uppercase">{warning.code}</span>
              {warning.location?.construct ? (
                <>
                  {' '}
                  · <span className="font-medium">{warning.location.construct}</span>
                </>
              ) : null}
              {warning.location?.chapter ? (
                <>
                  {' '}
                  in <span className="font-medium">{warning.location.chapter}</span>
                </>
              ) : null}
              : {warning.message}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
