export function compareDeterministicStrings(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

export function compareFiles(
  a: { relativePath?: string; name: string },
  b: { relativePath?: string; name: string },
): number {
  const pathA = (a.relativePath || a.name || "").replace(/\\/g, "/");
  const pathB = (b.relativePath || b.name || "").replace(/\\/g, "/");
  return compareDeterministicStrings(pathA, pathB) ||
    compareDeterministicStrings(a.name || "", b.name || "");
}
