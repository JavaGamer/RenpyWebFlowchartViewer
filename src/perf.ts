export interface PerfEvent {
  metric: string;
  ms: number;
  detail?: Record<string, unknown>;
}

function isPerfEnabled(): boolean {
  const perfFlag = (globalThis as { __RFV_DEBUG_PERF__?: unknown }).__RFV_DEBUG_PERF__;
  if (perfFlag === true) return true;
  try {
    if (typeof globalThis.localStorage === 'undefined') return false;
    return globalThis.localStorage.getItem('rfv.debugPerf') === 'true';
  } catch {
    return false;
  }
}

export function createPerfTracker(scope: string) {
  const enabled = isPerfEnabled();
  const marks = new Map<string, number>();

  return {
    enabled,
    mark(name: string) {
      if (!enabled) return;
      marks.set(name, performance.now());
    },
    measure(name: string, metric: string, detail?: Record<string, unknown>): number | null {
      if (!enabled) return null;
      const start = marks.get(name);
      if (start === undefined) return null;
      const ms = performance.now() - start;
      console.debug(
        `[perf:${scope}]`,
        detail === undefined ? { metric, ms } : { metric, ms, detail }
      );
      return ms;
    },
    log(metric: string, ms: number, detail?: Record<string, unknown>) {
      if (!enabled) return;
      console.debug(
        `[perf:${scope}]`,
        detail === undefined ? { metric, ms } : { metric, ms, detail }
      );
    },
  };
}
