import fc from "fast-check";
import type { FlowEdge, FlowNode } from "../../src/domain";

/**
 * Arbitrary generator for random Ren'Py script contents.
 * Generates combinations of valid statements, random indentation,
 * unclosed strings, python blocks, emojis, and control characters.
 */
export const renpyScriptArbitrary = fc.array(
  fc.oneof(
    // Valid label statement
    fc.stringMatching(/^[a-zA-Z_][a-zA-Z0-9_]*$/).map((name) => `label ${name}:`),
    // Jump statement
    fc.stringMatching(/^[a-zA-Z_][a-zA-Z0-9_]*$/).map((target) => `    jump ${target}`),
    // Call statement
    fc.stringMatching(/^[a-zA-Z_][a-zA-Z0-9_]*$/).map((target) => `    call ${target}`),
    // Menu statement
    fc.constant("    menu:"),
    // Menu choice line
    fc.string({ maxLength: 50 }).map((option) => `        "${option.replace(/"/g, '\\"')}":`),
    // Dialogue line
    fc.tuple(
      fc.option(fc.stringMatching(/^[a-zA-Z_][a-zA-Z0-9_]*$/)),
      fc.fullUnicodeString({ maxLength: 100 }),
    ).map(([who, text]) => {
      const escaped = text.replace(/"/g, '\\"');
      return who ? `    ${who} "${escaped}"` : `    "${escaped}"`;
    }),
    // Python block
    fc.array(fc.string({ maxLength: 60 }), { minLength: 1, maxLength: 5 }).map((lines) =>
      `    python:\n` + lines.map((l) => `        ${l}`).join("\n")
    ),
    // Arbitrary malformed string line with random indentation
    fc.tuple(
      fc.integer({ min: 0, max: 12 }).map((n) => " ".repeat(n)),
      fc.fullUnicodeString({ maxLength: 80 }),
    ).map(([indent, content]) => `${indent}${content}`),
  ),
  { minLength: 1, maxLength: 40 },
).map((lines) => lines.join("\n"));

/**
 * Arbitrary generator for random flowchart nodes and edges (Graph State Topology).
 * Generates cyclic graphs, self-loops, disconnected nodes, and varied node types.
 */
export const randomGraphArbitrary: fc.Arbitrary<{ nodes: FlowNode[]; edges: FlowEdge[] }> = fc.integer({
  min: 0,
  max: 60,
}).chain((nodeCount) => {
  if (nodeCount === 0) {
    return fc.constant({ nodes: [], edges: [] });
  }

  const nodeIds = Array.from({ length: nodeCount }, (_, i) => `node_${i}`);

  const nodesArbitrary = fc.array(
    fc.tuple(
      fc.constantFrom<"LABEL" | "MENU" | "DECISION">("LABEL", "MENU", "DECISION"),
      fc.fullUnicodeString({ maxLength: 30 }),
      fc.integer({ min: 0, max: 50 }),
      fc.array(fc.fullUnicodeString({ maxLength: 60 }), { maxLength: 5 }),
    ),
    { minLength: nodeCount, maxLength: nodeCount },
  ).map((rawNodes) =>
    rawNodes.map(([type, label, dialogueCount, dialogueLines], index) => ({
      id: nodeIds[index] ?? `node_${index}`,
      type,
      label: label || `node_${index}`,
      dialogueCount,
      dialogueLines,
      chapter: `chapter_${index % 3}`,
    }))
  );

  const edgesArbitrary = fc.array(
    fc.tuple(
      fc.integer({ min: 0, max: nodeCount - 1 }),
      fc.integer({ min: 0, max: nodeCount - 1 }),
      fc.constantFrom<"sequence" | "jump" | "call" | "call_return">("sequence", "jump", "call", "call_return"),
      fc.option(fc.fullUnicodeString({ maxLength: 20 })),
    ),
    { minLength: 0, maxLength: nodeCount * 2 },
  ).map((rawEdges) =>
    rawEdges.map(([srcIdx, tgtIdx, kind, label], edgeIdx) => ({
      id: `e_${edgeIdx}_${nodeIds[srcIdx] ?? "src"}_${nodeIds[tgtIdx] ?? "tgt"}`,
      source: nodeIds[srcIdx] ?? `node_${srcIdx}`,
      target: nodeIds[tgtIdx] ?? `node_${tgtIdx}`,
      kind,
      label: label ?? undefined,
    }))
  );

  return fc.tuple(nodesArbitrary, edgesArbitrary).map(([nodes, edges]) => ({
    nodes,
    edges,
  }));
});

/**
 * Arbitrary generator for corrupted zip file binary buffers.
 */
export const corruptedZipBufferArbitrary: fc.Arbitrary<Uint8Array> = fc.uint8Array({
  minLength: 0,
  maxLength: 10000,
});

/**
 * Arbitrary generator for condition logic expression strings.
 */
export const conditionExpressionArbitrary: fc.Arbitrary<string> = fc.oneof(
  fc.tuple(
    fc.stringMatching(/^[a-zA-Z_][a-zA-Z0-9_]*$/),
    fc.constantFrom("==", "!=", ">", "<", ">=", "<="),
    fc.oneof(fc.integer(), fc.boolean(), fc.string({ maxLength: 20 })),
  ).map(([varName, op, val]) => `${varName} ${op} ${JSON.stringify(val)}`),
  fc.fullUnicodeString({ maxLength: 50 }),
);
