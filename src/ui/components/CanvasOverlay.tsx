import { useEffect, useState } from "react";
import { useViewerStore } from "../../application/index.ts";
import { THEMES } from "../viewerTheme.ts";

interface CanvasOverlayProps {
  isCalculatingLayout: boolean;
}

export function CanvasOverlay({ isCalculatingLayout }: CanvasOverlayProps) {
  const theme = useViewerStore((s) => s.theme);
  const [showLayoutSpinner, setShowLayoutSpinner] = useState(false);

  useEffect(() => {
    if (!isCalculatingLayout) {
      const id = setTimeout(() => setShowLayoutSpinner(false), 0);
      return () => clearTimeout(id);
    }
    const id = setTimeout(() => setShowLayoutSpinner(true), 100);
    return () => clearTimeout(id);
  }, [isCalculatingLayout]);

  if (!showLayoutSpinner) return null;

  return (
    <div className="absolute inset-0 bg-white/45 backdrop-blur-md z-30 flex flex-col items-center justify-center animate-fade-in pointer-events-auto select-none">
      <div className="flex flex-col items-center gap-3">
        <div
          className="w-10 h-10 border-4 border-t-transparent rounded-full animate-spin"
          style={{
            borderColor: `${THEMES[theme].labelBorder}22`,
            borderTopColor: THEMES[theme].labelBorder,
          }}
        />
        <div className="text-center">
          <p
            className="text-sm font-semibold text-gray-950"
            style={{ color: THEMES[theme].text }}
          >
            Generating Flowchart Layout
          </p>
          <p
            className="text-xs text-gray-500 mt-1"
            style={{ color: THEMES[theme].subtleText }}
          >
            Optimizing nodes and branching paths...
          </p>
        </div>
      </div>
    </div>
  );
}
