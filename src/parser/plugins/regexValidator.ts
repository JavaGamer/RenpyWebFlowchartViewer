export function validateSafeRegexPattern(
  patternStr: string,
  flags = "i",
): RegExp {
  const trimmed = patternStr.trim();
  if (!trimmed) {
    throw new Error("Regex pattern must not be empty.");
  }
  if (trimmed.length > 300) {
    throw new Error(
      `Regex pattern exceeds maximum length of 300 characters (${trimmed.length}).`,
    );
  }
  // Check for nested quantifiers (e.g. (a+)+, (\w*)*, (a{1,})+) which cause exponential ReDoS
  if (
    /\([^)]*(?:[*+]|\{\d+,?\d*\})\)(?:\s*(?:[*+]|\{\d+,?\d*\}))/.test(trimmed)
  ) {
    throw new Error(
      `Regex pattern "${trimmed}" contains nested quantifiers, which may cause catastrophic backtracking.`,
    );
  }
  // Check for quantified alternation groups with internal quantifiers e.g. (a+|b+)+
  if (
    /\((?:[^)|]*[*+][^)|]*\|)+[^)]*\)(?:\s*(?:[*+]|\{\d+,?\d*\}))/.test(trimmed)
  ) {
    throw new Error(
      `Regex pattern "${trimmed}" contains quantified alternation branches with outer repetition, which causes catastrophic backtracking.`,
    );
  }
  // Check for identical or overlapping alternations with outer quantifiers e.g. (a|a)+, ([a-z]|\w)+, (x|[w-z])+
  if (
    /\(([a-zA-Z0-9_]+)\|\1\)(?:\s*(?:[*+]|\{\d+,?\d*\}))/.test(trimmed) ||
    /\((?:\\w|\\d|\[[^\]]+\]|[a-zA-Z0-9_])\|(?:\\w|\\d|\[[^\]]+\]|[a-zA-Z0-9_])\)(?:\s*(?:[*+]|\{\d+,?\d*\}))/i
      .test(trimmed)
  ) {
    throw new Error(
      `Regex pattern "${trimmed}" contains overlapping alternations with quantifiers, which may cause catastrophic backtracking.`,
    );
  }
  // Strip stateful /g and /y flags
  const safeFlags = flags.replace(/[gy]/g, "");
  let regex: RegExp;
  try {
    regex = new RegExp(trimmed, safeFlags);
  } catch (err) {
    throw new Error(
      `Invalid regular expression "${trimmed}": ${(err as Error).message}`,
      { cause: err },
    );
  }
  if (regex.test("")) {
    throw new Error(
      `Regex pattern "${trimmed}" must not match an empty string.`,
    );
  }
  if (regex.test("   ")) {
    throw new Error(
      `Regex pattern "${trimmed}" must not match pure whitespace.`,
    );
  }

  // Runtime benchmark probe against common and pattern-derived mismatch strings to detect exponential/high-polynomial backtracking
  const probeChars = new Set<string>(["a", " ", "0", "b", "x", "1", "_"]);
  const patternLiterals = trimmed.match(/[a-zA-Z0-9_]/g);
  if (patternLiterals) {
    for (const ch of patternLiterals.slice(0, 10)) {
      probeChars.add(ch);
    }
  }

  const probeStrings: string[] = [];
  for (const ch of probeChars) {
    probeStrings.push(ch.repeat(26) + "!");
    probeStrings.push(ch.repeat(13) + "\n" + ch.repeat(13) + "!");
  }

  for (const probe of probeStrings) {
    const start = typeof performance !== "undefined"
      ? performance.now()
      : Date.now();
    regex.test(probe);
    const elapsed =
      (typeof performance !== "undefined" ? performance.now() : Date.now()) -
      start;
    if (elapsed > 10) {
      throw new Error(
        `Regex pattern "${trimmed}" exhibited excessive execution time on benchmark probe (${
          elapsed.toFixed(1)
        }ms).`,
      );
    }
  }

  return regex;
}
