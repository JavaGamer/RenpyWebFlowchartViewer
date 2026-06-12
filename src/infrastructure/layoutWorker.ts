import { applyElkLayout } from '../domain';


self.onmessage = async (event: MessageEvent) => {
  const { requestId, rawNodes, rawEdges, direction, options } = event.data;

  try {
    const result = await applyElkLayout(rawNodes, rawEdges, direction, {
      theme: options?.theme,
    });

    self.postMessage({
      requestId,
      result,
    });
  } catch (error: unknown) {
    self.postMessage({
      requestId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
