/**
 * src/application/downloadHelper.ts
 *
 * Standardized client-side blob download helper.
 */

export async function downloadBlob(
  blob: Blob,
  filename: string,
): Promise<void> {
  try {
    const fileSaver = await import("file-saver");
    const saveAs = fileSaver.saveAs ??
      (fileSaver as unknown as { default: (b: Blob, f: string) => void })
        .default;
    if (typeof saveAs === "function") {
      saveAs(blob, filename);
      return;
    }
  } catch (err) {
    if (err instanceof Error && err.message === "save failed") {
      throw err;
    }
  }

  if (typeof window !== "undefined" && typeof document !== "undefined") {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      if (a.parentNode) {
        a.parentNode.removeChild(a);
      }
      URL.revokeObjectURL(url);
    }, 200);
  }
}
