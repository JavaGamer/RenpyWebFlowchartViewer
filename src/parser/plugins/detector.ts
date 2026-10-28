import type { ParserVariantPlugin } from "./types.ts";
import {
  AUTO_PARSER_VARIANT,
  FALLBACK_PARSER_VARIANT,
  getParserVariantPlugin,
  getParserVariantPlugins,
  isParserVariant,
} from "./pluginRegistry.ts";

export interface VariantDetectionEvidence {
  signature: string;
  matchCount: number;
  sampleLocations: string[];
  weight: number;
}

export interface VariantCandidateScore {
  variantId: string;
  label: string;
  score: number;
  confidencePercent: number;
  evidence: VariantDetectionEvidence[];
}

export interface VariantDetectionEvidenceSummary {
  matchedPragma?: string;
  matchedPathPatterns: string[];
  matchedKeywords: string[];
}

export interface VariantCandidateScoreItem {
  variant: string;
  label: string;
  score: number;
  confidence?: number;
}

export interface VariantDetectionResult {
  variant: string;
  isAutoDetected: boolean;
  confidencePercent: number;
  confidence: number;
  matchedSignature?: string;
  evidenceSummary?: string;
  summary: string;
  candidates?: VariantCandidateScore[];
  scores: VariantCandidateScoreItem[];
  evidence: VariantDetectionEvidenceSummary;
  pragmaOverride?: boolean;
}

export type DetectVariantInput =
  | string
  | {
    name?: string;
    path?: string;
    content?: string;
    contentSample?: string;
  };

export function detectParserVariant(
  contents: Iterable<DetectVariantInput>,
  fallbackVariant: string = FALLBACK_PARSER_VARIANT,
): VariantDetectionResult {
  const plugins = getParserVariantPlugins();
  const normalizedInputs: Array<{ name: string; path: string; text: string }> =
    [];

  for (const item of contents) {
    if (!item) continue;
    if (typeof item === "string") {
      normalizedInputs.push({ name: "", path: "", text: item });
    } else {
      const rawPath = item.path ?? item.name ?? "";
      const rawName = item.name ?? "";
      normalizedInputs.push({
        name: rawName.replace(/\\/g, "/"),
        path: rawPath.replace(/\\/g, "/"),
        text: item.content ?? item.contentSample ?? "",
      });
    }
  }

  // 1. Sniff for explicit script pragma in first 2000 chars of each file
  const pragmaGlobalRegex =
    /^\s*#\s*(?:@flowchart-variant|@variant|renpy-variant)\s*:\s*([a-z0-9_-]+)/gim;
  for (const file of normalizedInputs) {
    const headerSample = file.text.slice(0, 2000);
    let match: RegExpExecArray | null;
    while ((match = pragmaGlobalRegex.exec(headerSample)) !== null) {
      const pragmaId = match[1]!.toLowerCase().trim();
      if (isParserVariant(pragmaId) && pragmaId !== AUTO_PARSER_VARIANT) {
        const plugin = getParserVariantPlugin(pragmaId);
        return {
          variant: pragmaId,
          isAutoDetected: true,
          confidencePercent: 100,
          confidence: 100,
          pragmaOverride: true,
          matchedSignature: match[0],
          evidenceSummary: `Explicit pragma override locked via ${
            file.name || "script"
          }: ${match[0]}`,
          summary: `Explicit pragma override locked via ${
            file.name || "script"
          }: ${match[0]}`,
          candidates: [
            {
              variantId: pragmaId,
              label: plugin.label,
              score: 1000,
              confidencePercent: 100,
              evidence: [
                {
                  signature: match[0],
                  matchCount: 1,
                  sampleLocations: [file.name ? `${file.name}:1` : "script:1"],
                  weight: 1000,
                },
              ],
            },
          ],
          scores: [
            {
              variant: pragmaId,
              label: plugin.label,
              score: 1000,
              confidence: 100,
            },
          ],
          evidence: {
            matchedPragma: pragmaId,
            matchedPathPatterns: [],
            matchedKeywords: [match[0]],
          },
        };
      }
    }
  }

  // 2. Multi-signal weighted scoring across candidate plugins
  const candidatePlugins = plugins.filter(
    (p) =>
      p.id !== fallbackVariant &&
      ((p.detectionSignatures && p.detectionSignatures.length > 0) ||
        (p.detectionFilePatterns && p.detectionFilePatterns.length > 0)),
  );

  const scores = new Map<
    string,
    {
      plugin: ParserVariantPlugin;
      score: number;
      evidenceMap: Map<string, VariantDetectionEvidence>;
    }
  >();

  for (const p of candidatePlugins) {
    scores.set(p.id, {
      plugin: p,
      score: 0,
      evidenceMap: new Map(),
    });
  }

  for (const file of normalizedInputs) {
    const { name, path, text } = file;
    const fileLabel = name || path || "script.rpy";

    // Path / filename patterns
    if (name || path) {
      for (const p of candidatePlugins) {
        if (!p.detectionFilePatterns) continue;
        for (const pattern of p.detectionFilePatterns) {
          pattern.lastIndex = 0;
          if (pattern.test(name) || pattern.test(path)) {
            const entry = scores.get(p.id)!;
            entry.score += 8;
            const key = `path:${pattern.source}`;
            const existing = entry.evidenceMap.get(key);
            if (existing) {
              existing.matchCount += 1;
              if (existing.sampleLocations.length < 3) {
                existing.sampleLocations.push(fileLabel);
              }
            } else {
              entry.evidenceMap.set(key, {
                signature: `File pattern: ${pattern.source}`,
                matchCount: 1,
                sampleLocations: [fileLabel],
                weight: 8,
              });
            }
          }
        }
      }
    }

    if (!text) continue;

    const fileLines = text.split("\n");

    // Content regex signatures
    for (const p of candidatePlugins) {
      if (!p.detectionSignatures) continue;
      for (const sig of p.detectionSignatures) {
        sig.lastIndex = 0;
        let count = 0;
        if (sig.global) {
          count = (text.match(sig) || []).length;
          if (count > 0) {
            const entry = scores.get(p.id)!;
            const weight = sig.source.length > 25 ? 8 : 3;
            entry.score += weight * Math.min(count, 5);
            const key = `sig:${sig.source}`;
            let ev = entry.evidenceMap.get(key);
            if (!ev) {
              ev = {
                signature: sig.source,
                matchCount: count,
                sampleLocations: [fileLabel],
                weight,
              };
              entry.evidenceMap.set(key, ev);
            } else {
              ev.matchCount += count;
            }
          }
        } else {
          for (let lIdx = 0; lIdx < fileLines.length && count < 10; lIdx++) {
            sig.lastIndex = 0;
            if (sig.test(fileLines[lIdx]!)) {
              count++;
              const entry = scores.get(p.id)!;
              const key = `sig:${sig.source}`;
              let ev = entry.evidenceMap.get(key);
              if (!ev) {
                const weight = sig.source.length > 25 ? 8 : 3;
                ev = {
                  signature: sig.source,
                  matchCount: 0,
                  sampleLocations: [],
                  weight,
                };
                entry.evidenceMap.set(key, ev);
              }
              ev.matchCount++;
              if (ev.sampleLocations.length < 3) {
                ev.sampleLocations.push(`${fileLabel}:${lIdx + 1}`);
              }
            }
          }

          if (count > 0) {
            const entry = scores.get(p.id)!;
            const ev = entry.evidenceMap.get(`sig:${sig.source}`);
            if (ev) {
              entry.score += ev.weight * Math.min(count, 5);
            }
          }
        }
      }
    }
  }

  // 3. Score calculation and ranking
  const activeCandidates: VariantCandidateScore[] = [];
  for (const [id, entry] of scores.entries()) {
    if (entry.score > 0) {
      activeCandidates.push({
        variantId: id,
        label: entry.plugin.label,
        score: entry.score,
        confidencePercent: 0,
        evidence: Array.from(entry.evidenceMap.values()),
      });
    }
  }

  activeCandidates.sort((a, b) => b.score - a.score);

  if (activeCandidates.length === 0) {
    return {
      variant: fallbackVariant,
      isAutoDetected: true,
      confidencePercent: 0,
      confidence: 0,
      evidenceSummary:
        "Default fallback (no distinct variant signatures found)",
      summary: "Default fallback (no distinct variant signatures found)",
      candidates: [],
      scores: [],
      evidence: {
        matchedPragma: undefined,
        matchedPathPatterns: [],
        matchedKeywords: [],
      },
    };
  }

  const winner = activeCandidates[0]!;
  const runnerUp = activeCandidates[1];

  const confidence = !runnerUp
    ? (winner.score >= 15 ? 98 : (winner.score >= 6 ? 92 : 80))
    : Math.min(
      99,
      Math.max(
        50,
        Math.round(
          60 +
            39 *
              ((winner.score - runnerUp.score) /
                (winner.score + runnerUp.score + 2)),
        ),
      ),
    );

  winner.confidencePercent = confidence;

  const topEvidence = winner.evidence
    .slice(0, 3)
    .map((e) => `${e.signature} (${e.matchCount}x)`)
    .join(", ");

  const summary =
    `Auto-detected ${winner.label} (${confidence}% confidence, score ${winner.score})${
      topEvidence ? `: ${topEvidence}` : ""
    }`;

  return {
    variant: winner.variantId,
    isAutoDetected: true,
    confidencePercent: confidence,
    confidence,
    matchedSignature: winner.evidence[0]?.signature,
    evidenceSummary: summary,
    summary,
    candidates: activeCandidates,
    scores: activeCandidates.map((c) => ({
      variant: c.variantId,
      label: c.label,
      score: c.score,
      confidence: c.confidencePercent,
    })),
    evidence: {
      matchedPragma: undefined,
      matchedPathPatterns: winner.evidence
        .filter((e) => e.signature.startsWith("File pattern:"))
        .map((e) => e.signature),
      matchedKeywords: winner.evidence
        .filter((e) => !e.signature.startsWith("File pattern:"))
        .map((e) => e.signature),
    },
  };
}
