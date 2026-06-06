

import type { ParseDiagnosticPayload } from '../infrastructure';

export interface DiagnosticsSectionProps {
  parseDiagnostics: ParseDiagnosticPayload[];
}

export default function DiagnosticsSection({ parseDiagnostics }: DiagnosticsSectionProps) {
  if (parseDiagnostics.length === 0) return null;

  return (
    <section
      className="shrink-0 border-b border-amber-200 bg-amber-50 px-4 py-3 text-amber-900"
      aria-label="Parser warnings"
    >
      <p className="text-sm font-semibold">Parser warnings</p>
      <ul className="mt-1 list-disc pl-5 text-xs space-y-1">
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
    </section>
  );
}
