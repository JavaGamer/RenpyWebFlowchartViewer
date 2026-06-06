import { applyDagreLayout } from '../domain';


self.onmessage = (event: MessageEvent) => {
  const { requestId, rawNodes, rawEdges, direction, options } = event.data;

  let previousPositions: Map<string, { x: number; y: number }> | undefined;
  if (options?.previousPositions) {
    if (Array.isArray(options.previousPositions)) {
      previousPositions = new Map(options.previousPositions);
    } else if (options.previousPositions instanceof Map) {
      previousPositions = options.previousPositions;
    } else {
      previousPositions = new Map(Object.entries(options.previousPositions));
    }
  }

  const result = applyDagreLayout(rawNodes, rawEdges, direction, {
    ...options,
    previousPositions,
  });

  self.postMessage({
    requestId,
    result,
  });
};
