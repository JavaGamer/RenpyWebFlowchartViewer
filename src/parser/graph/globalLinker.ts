/**
 * src/parser/graph/globalLinker.ts
 *
 * Multi-File Global Linker:
 * Combines per-file graph fragments, resolves cross-file call returns,
 * and performs reachability analysis.
 */

import {
  evaluatePythonAstExpression,
  extractConditionFlagRefs,
  type FlowEdge,
  type FlowNode,
  type VariableMutation,
} from "../../domain/index.ts";
import type { GraphBuildResult } from "./graphBuilder.ts";
import { parseDictLiteral } from "../utils.ts";
import { getParserVariantPlugins } from "../plugins/index.ts";
import type {
  DynamicJumpRule,
  InitVariableDescriptor,
  ParseDiagnostic,
} from "../pipelineTypes.ts";

export interface GlobalLinkerOptions {
  dynamicJumpRules?: DynamicJumpRule[];
  parserVariant?: string;
  maxCallStackDepth?: number;
}

export interface LinkedProjectGraph {
  nodes: FlowNode[];
  edges: FlowEdge[];
  diagnostics?: ParseDiagnostic[];
  initVariables?: Map<string, InitVariableDescriptor>;
  imageDefinitions?: Map<string, string>;
}

export function linkProjectGraphs(
  fragments: GraphBuildResult[],
  options: GlobalLinkerOptions = {},
): LinkedProjectGraph {
  const nodeMap = new Map<string, FlowNode>();
  const allEdges: FlowEdge[] = [];
  const edgeIds = new Set<string>();
  const allDiagnostics: ParseDiagnostic[] = [];

  for (const frag of fragments) {
    if (frag.diagnostics) {
      allDiagnostics.push(...frag.diagnostics);
    }
  }

  // Combine and sort initVariables across fragments
  const allInitDescriptors: InitVariableDescriptor[] = [];
  for (const frag of fragments) {
    if (frag.initDescriptors) {
      allInitDescriptors.push(...frag.initDescriptors);
    } else if (frag.initVariables) {
      for (const desc of frag.initVariables.values()) {
        allInitDescriptors.push(desc);
      }
    }
  }

  // Sort by priority ascending (e.g. -10000 first, then -25, 0, 10, 50)
  // At equal priority: default runs before define (so define overwrites default)
  const KIND_PRECEDENCE: Record<string, number> = {
    default: 0,
    persistent: 1,
    init: 1,
    python: 1,
    define: 2,
  };

  // Sort by priority ascending (e.g. -10000 first, then -25, 0, 10, 50)
  // At equal priority: default (0) runs before persistent/init (1), before define (2)
  // So higher-precedence statements appear later and cleanly overwrite lower ones
  allInitDescriptors.sort((a, b) => {
    if (a.priority !== b.priority) {
      return a.priority - b.priority;
    }
    const orderA = KIND_PRECEDENCE[a.kind] ?? 1;
    const orderB = KIND_PRECEDENCE[b.kind] ?? 1;
    if (orderA !== orderB) {
      return orderA - orderB;
    }
    return 0;
  });

  const combinedInitVars = new Map<string, InitVariableDescriptor>();
  const env: Record<string, unknown> = {};

  for (const desc of allInitDescriptors) {
    let normalizedValue: unknown;
    if (desc.value instanceof Map) {
      const obj: Record<string, string> = {};
      for (const [k, v] of desc.value.entries()) {
        obj[k] = v;
      }
      normalizedValue = obj;
    } else if (Array.isArray(desc.value)) {
      normalizedValue = desc.value;
    } else if (desc.value === "True" || desc.value === true) {
      normalizedValue = true;
    } else if (desc.value === "False" || desc.value === false) {
      normalizedValue = false;
    } else if (desc.value === null || desc.value === undefined) {
      normalizedValue = desc.value;
    } else if (typeof desc.value === "number") {
      normalizedValue = desc.value;
    } else if (
      typeof desc.value === "string" &&
      desc.value.trim().startsWith("{") &&
      desc.value.trim().endsWith("}")
    ) {
      const parsedDict = parseDictLiteral(desc.value);
      if (parsedDict) {
        const obj: Record<string, string> = {};
        for (const [k, v] of parsedDict.entries()) {
          obj[k] = v;
        }
        normalizedValue = obj;
      } else {
        normalizedValue = desc.value;
      }
    } else if (
      typeof desc.value === "string" &&
      desc.value.trim().startsWith("[") &&
      desc.value.trim().endsWith("]")
    ) {
      normalizedValue = desc.value
        .trim()
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
    } else {
      normalizedValue = String(desc.value);
    }

    env[desc.name] = normalizedValue;
    combinedInitVars.set(desc.name, {
      ...desc,
      value: normalizedValue as InitVariableDescriptor["value"],
    });
    if (desc.name.startsWith("persistent.")) {
      const shortName = desc.name.replace(/^persistent\./, "");
      if (!env.persistent || typeof env.persistent !== "object") {
        env.persistent = {};
      }
      (env.persistent as Record<string, unknown>)[shortName] = desc.value;
    }
  }

  // 1. Merge all nodes with duplicate label shadowing and per-fragment edge remapping
  const seenCount = new Map<string, number>();
  for (const frag of fragments) {
    const relabelMap = new Map<string, string>();
    for (const node of frag.nodes) {
      if (node.type === "LABEL") {
        const count = (seenCount.get(node.id) || 0) + 1;
        seenCount.set(node.id, count);
        if (count === 1) {
          nodeMap.set(node.id, { ...node });
        } else {
          const shadowId = `${node.id}__shadow_${count}`;
          relabelMap.set(node.id, shadowId);
          nodeMap.set(shadowId, {
            ...node,
            id: shadowId,
            isShadowed: true,
            shadowOfId: node.id,
          });
          allDiagnostics.push({
            code: "shadowed_label",
            severity: "warning",
            message:
              `Label "${node.label}" shadows an existing label defined in an earlier file.`,
            recoveryAction:
              "Ensure all label names are globally unique across the project.",
            location: {
              chapter: node.chapter || "",
              targetExpression: node.label,
              sourceId: shadowId,
              targetId: node.id,
              sourceLocation: node.sourceLocation,
            },
            context: {
              category: "shadowed_label",
              detail: node.label,
            },
          });
        }
      } else {
        if (!nodeMap.has(node.id)) {
          nodeMap.set(node.id, { ...node });
        }
      }
    }

    // Remap local edges in this fragment if any label was shadowed
    for (const edge of frag.edges) {
      const newSource = relabelMap.get(edge.source) ?? edge.source;
      const newTarget = relabelMap.get(edge.target) ?? edge.target;
      const newId = (newSource !== edge.source || newTarget !== edge.target)
        ? `${edge.id}__shadow_${
          seenCount.get(edge.source) || seenCount.get(edge.target) || 2
        }`
        : edge.id;

      if (!edgeIds.has(newId)) {
        edgeIds.add(newId);
        allEdges.push({
          ...edge,
          id: newId,
          source: newSource,
          target: newTarget,
        });
      }
    }
  }

  // 3. Resolve subroutine call returns
  // For each 'call' edge, link an explicit 'call_return' edge from target back to returnTargetId
  const allReliableReturns = new Set<string>();
  for (const frag of fragments) {
    if (frag.hasReliableReturnInLabel) {
      for (const r of frag.hasReliableReturnInLabel) {
        allReliableReturns.add(r);
      }
    }
  }

  const callEdges = allEdges.filter((e) => e.kind === "call" && e.callContext);
  for (const callEdge of callEdges) {
    const ctx = callEdge.callContext!;
    const retEdgeId = `ret_${ctx.callContextId}`;
    if (
      !edgeIds.has(retEdgeId) && nodeMap.has(callEdge.target) &&
      nodeMap.has(ctx.returnTargetId) &&
      allReliableReturns.has(callEdge.target)
    ) {
      edgeIds.add(retEdgeId);
      allEdges.push({
        id: retEdgeId,
        source: callEdge.target,
        target: ctx.returnTargetId,
        kind: "call_return",
        callContext: ctx,
        label: "return",
      });

      // Also connect any menu nodes inside the target label to returnTargetId
      for (const mNode of nodeMap.values()) {
        if (mNode.type === "MENU" && mNode.parentLabelId === callEdge.target) {
          const menuRetId = `ret_${ctx.callContextId}__${mNode.id}`;
          if (!edgeIds.has(menuRetId)) {
            edgeIds.add(menuRetId);
            allEdges.push({
              id: menuRetId,
              source: mNode.id,
              target: ctx.returnTargetId,
              kind: "call_return",
              label: "return",
            });
          }
        }
      }
    }
  }

  // Classify node roles based on topology and call semantics
  const incomingTrafficByNode = new Map<string, Set<string>>();
  const outgoingTrafficByNode = new Map<string, Set<string>>();
  const externalTrafficByBaseLabel = new Map<string, Set<string>>();
  const calledLabels = new Set<string>();
  const calledFromMenuOptionTargets = new Set<string>();

  function getBaseLabel(id: string, map: Map<string, FlowNode>): string {
    const node = map.get(id);
    if (node?.parentLabelId) return node.parentLabelId;
    const contIdx = id.indexOf("__cont_");
    if (contIdx !== -1) return id.slice(0, contIdx);
    const sceneIdx = id.indexOf("__scene_");
    if (sceneIdx !== -1) return id.slice(0, sceneIdx);
    return id;
  }

  for (const e of allEdges) {
    if (e.kind === "call") {
      calledLabels.add(e.target);
      const srcNode = nodeMap.get(e.source);
      if (srcNode?.type === "MENU") {
        calledFromMenuOptionTargets.add(e.target);
      }
    }

    if (!incomingTrafficByNode.has(e.target)) {
      incomingTrafficByNode.set(e.target, new Set());
    }
    if (e.kind) incomingTrafficByNode.get(e.target)!.add(e.kind);

    if (!outgoingTrafficByNode.has(e.source)) {
      outgoingTrafficByNode.set(e.source, new Set());
    }
    if (e.kind) outgoingTrafficByNode.get(e.source)!.add(e.kind);

    const srcBase = getBaseLabel(e.source, nodeMap);
    const tgtBase = getBaseLabel(e.target, nodeMap);
    if (srcBase !== tgtBase) {
      if (!externalTrafficByBaseLabel.has(tgtBase)) {
        externalTrafficByBaseLabel.set(tgtBase, new Set());
      }
      if (e.kind) externalTrafficByBaseLabel.get(tgtBase)!.add(e.kind);

      if (!externalTrafficByBaseLabel.has(srcBase)) {
        externalTrafficByBaseLabel.set(srcBase, new Set());
      }
      if (e.kind) externalTrafficByBaseLabel.get(srcBase)!.add(e.kind);
    }
  }

  const allNodesList = Array.from(nodeMap.values());
  for (const node of allNodesList) {
    if (node.type === "MENU") {
      node.role = "menu";
    } else if (node.type === "DECISION") {
      if (node.role !== "while_loop" && node.role !== "for_loop") {
        node.role = "decision";
      }
    } else if (node.type === "LABEL") {
      const outgoing = outgoingTrafficByNode.get(node.id);
      const hasReturn = allReliableReturns.has(node.id);
      const isCalled = calledLabels.has(node.id);
      const isCalledFromMenu = calledFromMenuOptionTargets.has(node.id);
      const baseLabel = getBaseLabel(node.id, nodeMap);
      const ext = externalTrafficByBaseLabel.get(baseLabel);
      const hasStoryTraffic = Boolean(
        ext?.has("sequence") ||
          ext?.has("jump") ||
          ext?.has("fallthrough"),
      );

      const isUtilityByPattern = options.parserVariant && (() => {
        const plugins = getParserVariantPlugins();
        const activePlugin = plugins.find((p) =>
          p.id === options.parserVariant
        );
        return activePlugin?.utilityLabelPatterns?.some((p) =>
          p.test(node.id) || p.test(node.label || "")
        );
      })();

      if (isUtilityByPattern) {
        node.role = "utility";
      } else if (hasReturn && !hasStoryTraffic && !isCalled) {
        node.role = "state_toggle";
      } else if (isCalledFromMenu && hasReturn) {
        node.role = "detour";
      } else if (isCalled && hasReturn && !hasStoryTraffic) {
        node.role = "utility";
      } else {
        node.role = "story";
      }

      if (node.role === "story") {
        if (!isCalled && (hasReturn || !outgoing || outgoing.size === 0)) {
          node.isTerminalOutcome = true;
        } else {
          node.isTerminalOutcome = false;
        }
      } else {
        node.isTerminalOutcome = false;
      }
    }
  }

  // Propagate utility/detour roles to continuation nodes
  for (const node of nodeMap.values()) {
    if (node.id.includes("__cont_")) {
      const baseLabelId = node.id.split("__cont_")[0]!;
      const parentNode = nodeMap.get(baseLabelId);
      if (
        parentNode &&
        (parentNode.role === "utility" || parentNode.role === "detour")
      ) {
        node.role = parentNode.role;
      }
    }
  }

  // 4. Reachability analysis: mark unreachable nodes as isOrphan
  const allNodes = Array.from(nodeMap.values());
  const incomingMap = new Map<string, number>();
  for (const n of allNodes) {
    incomingMap.set(n.id, 0);
  }
  for (const e of allEdges) {
    if (incomingMap.has(e.target)) {
      incomingMap.set(e.target, (incomingMap.get(e.target) || 0) + 1);
    }
  }

  // Entry point roots: "start", "splashscreen", "main_menu", "after_load"
  const KNOWN_ENTRY_POINTS = new Set([
    "start",
    "splashscreen",
    "main_menu",
    "after_load",
  ]);
  const roots: string[] = [];

  for (const n of allNodes) {
    if (KNOWN_ENTRY_POINTS.has(n.id)) {
      roots.push(n.id);
    }
  }

  // If no exact match, check for prefixed or suffixed entry point names (e.g. sc_custom_start)
  if (roots.length === 0) {
    for (const n of allNodes) {
      if (
        n.type === "LABEL" &&
        (/(?:^|_)start(?:$|_)/i.test(n.id) ||
          /(?:^|_)splashscreen(?:$|_)/i.test(n.id) ||
          /(?:^|_)main_menu(?:$|_)/i.test(n.id)) &&
        !n.id.includes("__cont_")
      ) {
        roots.push(n.id);
      }
    }
  }

  // If no entry point exists in the project, fallback to nodes with 0 incoming edges
  if (roots.length === 0) {
    for (const n of allNodes) {
      if (
        incomingMap.get(n.id) === 0 &&
        !n.id.includes("__cont_")
      ) {
        roots.push(n.id);
      }
    }
  }

  const visited = new Set<string>();
  const queue = [...roots];
  for (const r of roots) {
    visited.add(r);
  }

  const outgoingMap = new Map<string, string[]>();
  for (const e of allEdges) {
    if (!outgoingMap.has(e.source)) {
      outgoingMap.set(e.source, []);
    }
    outgoingMap.get(e.source)!.push(e.target);
  }

  while (queue.length > 0) {
    const curr = queue.shift()!;
    const neighbors = outgoingMap.get(curr) || [];
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
  }

  for (const n of allNodes) {
    if (!visited.has(n.id)) {
      n.isOrphan = true;
    }
  }

  // 5. Global dynamic jump resolution
  const resolvedDynamicTargets = new Set<string>();
  for (const frag of fragments) {
    if (frag.unresolvedDynamicJumps) {
      for (const dj of frag.unresolvedDynamicJumps) {
        const targets: string[] = [];

        // Check options.dynamicJumpRules
        if (options.dynamicJumpRules) {
          for (const rule of options.dynamicJumpRules) {
            const ruleRegex = new RegExp(rule.expressionPattern);
            if (ruleRegex.test(dj.targetExpression)) {
              if (Array.isArray(rule.targets)) {
                targets.push(...rule.targets);
              }
            }
          }
        }

        // If not matched by custom rule, evaluate with env
        if (targets.length === 0) {
          const evalRes = evaluatePythonAstExpression(dj.targetExpression, env);
          if (
            evalRes.isStaticallyEvaluated && typeof evalRes.value === "string"
          ) {
            targets.push(evalRes.value);
          } else if (
            evalRes.stringCandidates && evalRes.stringCandidates.length > 0
          ) {
            for (const cand of evalRes.stringCandidates) {
              if (nodeMap.has(cand)) {
                targets.push(cand);
              }
            }
          }
        }

        if (targets.length === 0) {
          const cleanExpr = dj.targetExpression.replace(
            /^\s*\(\s*|\s*\)\s*$/g,
            "",
          ).trim();
          let prefix = "";
          let suffix = "";
          const fStringMatch = /^[fF]["']([^"'{]*)(?:\{[^}]+\})+(.*?)["']$/
            .exec(cleanExpr);
          if (fStringMatch) {
            prefix = fStringMatch[1] ?? "";
            suffix = fStringMatch[2] ?? "";
          }
          if (!prefix && !suffix) {
            const stringLiterals: Array<
              { value: string; index: number; end: number }
            > = [];
            const stringRegex =
              /(?:[rR][bB]|[bB][rR]|[rR][uU]|[uU][rR]|[fF][rR]|[rR][fF]|[rR]|[uU]|[bB]|[fF])?["']([^"'\n\\]*(?:\\.[^"'\n\\]*)*)["']/g;
            let m: RegExpExecArray | null;
            while ((m = stringRegex.exec(cleanExpr)) !== null) {
              stringLiterals.push({
                value: m[1]!,
                index: m.index,
                end: m.index + m[0].length,
              });
            }
            if (stringLiterals.length === 1) {
              const lit = stringLiterals[0]!;
              if (lit.index === 0) {
                prefix = lit.value;
              } else {
                suffix = lit.value;
              }
            } else if (stringLiterals.length >= 2) {
              const first = stringLiterals[0]!;
              const last = stringLiterals[stringLiterals.length - 1]!;
              if (first.index === 0) {
                prefix = first.value;
              }
              if (
                last.end >= cleanExpr.length - 1 ||
                cleanExpr.slice(last.end).trim() === ""
              ) {
                suffix = last.value;
              }
            }
          }
          if (prefix || suffix) {
            for (const [labelId] of nodeMap.entries()) {
              if (prefix && suffix) {
                if (
                  labelId.startsWith(prefix) && labelId.endsWith(suffix) &&
                  labelId.length >= prefix.length + suffix.length
                ) {
                  targets.push(labelId);
                }
              } else if (prefix) {
                if (labelId.startsWith(prefix)) {
                  targets.push(labelId);
                }
              } else if (suffix) {
                if (labelId.endsWith(suffix)) {
                  targets.push(labelId);
                }
              }
            }
          }
        }

        for (const t of targets) {
          const edgeId =
            `djump_${dj.sourceNodeId}__${t}_L${dj.sourceLocation.start.line}`;
          if (!edgeIds.has(edgeId)) {
            edgeIds.add(edgeId);
            allEdges.push({
              id: edgeId,
              source: dj.sourceNodeId,
              target: t,
              kind: "jump",
              sourceLocation: {
                file: dj.sourceLocation.file,
                start: {
                  line: dj.sourceLocation.start.line,
                  character: dj.sourceLocation.start.column,
                  offset: dj.sourceLocation.start.offset,
                },
                end: {
                  line: dj.sourceLocation.end.line,
                  character: dj.sourceLocation.end.column,
                  offset: dj.sourceLocation.end.offset,
                },
              },
            });
          }
          resolvedDynamicTargets.add(
            `${dj.sourceNodeId}|${dj.targetExpression}`,
          );
        }
      }
    }
  }

  // Filter out dynamic_target diagnostics for resolved dynamic jumps
  const filteredDiagnostics = allDiagnostics.filter((d) => {
    if (
      d.code === "dynamic_target" && d.location?.sourceId &&
      d.location?.targetExpression
    ) {
      const key = `${d.location.sourceId}|${d.location.targetExpression}`;
      if (resolvedDynamicTargets.has(key)) {
        return false;
      }
    }
    return true;
  });

  // 6. Statically false condition edge tagging and dead menu option analysis
  for (const edge of allEdges) {
    if (edge.condition?.expression) {
      const srcNode = nodeMap.get(edge.source);
      const parentLabel = srcNode?.parentLabelId
        ? nodeMap.get(srcNode.parentLabelId)
        : srcNode;
      const localEnv = { ...env };
      const applyMutToEnv = (
        m: VariableMutation,
        targetEnv: Record<string, unknown>,
      ) => {
        if (m.operator === "=") {
          targetEnv[m.variableName] = m.value;
        } else if (m.operator === "+=") {
          const prev = Number(targetEnv[m.variableName] ?? 0);
          targetEnv[m.variableName] = prev + Number(m.value);
        } else if (m.operator === "-=") {
          const prev = Number(targetEnv[m.variableName] ?? 0);
          targetEnv[m.variableName] = prev - Number(m.value);
        } else if (m.operator === "*=") {
          const prev = Number(targetEnv[m.variableName] ?? 0);
          targetEnv[m.variableName] = prev * Number(m.value);
        } else if (m.operator === "/=") {
          const prev = Number(targetEnv[m.variableName] ?? 0);
          targetEnv[m.variableName] = prev / Number(m.value);
        } else if (m.operator === "toggle") {
          targetEnv[m.variableName] = !targetEnv[m.variableName];
        }
      };

      if (parentLabel?.mutations) {
        for (const m of parentLabel.mutations) {
          applyMutToEnv(m, localEnv);
        }
      }
      if (srcNode?.mutations && srcNode !== parentLabel) {
        for (const m of srcNode.mutations) {
          applyMutToEnv(m, localEnv);
        }
      }

      const evalRes = evaluatePythonAstExpression(
        edge.condition.expression,
        localEnv,
      );
      if (evalRes.isStaticallyEvaluated && !evalRes.value) {
        edge.conditionIsStaticallyFalse = true;
        if (
          srcNode?.type === "MENU" ||
          edge.kind === "jump"
        ) {
          filteredDiagnostics.push({
            code: "normalization",
            severity: "warning",
            message: `Menu option "${
              edge.label || edge.target
            }" will never execute because condition "${edge.condition.expression}" is statically False.`,
            location: {
              sourceId: edge.source,
              targetId: edge.target,
              edgeId: edge.id,
              sourceLocation: edge.sourceLocation,
            },
            context: {
              category: "dead_menu_option",
              detail: edge.label ?? edge.target,
            },
          });
        }
      }
    }
  }

  // 7. Dangling stack analysis: detect subroutines called that do not return
  for (const callEdge of callEdges) {
    if (!allReliableReturns.has(callEdge.target)) {
      filteredDiagnostics.push({
        code: "normalization",
        severity: "warning",
        message:
          `Label "${callEdge.target}" called from "${callEdge.source}" does not return, resulting in a dangling call stack frame.`,
        location: {
          sourceId: callEdge.source,
          targetId: callEdge.target,
          edgeId: callEdge.id,
          sourceLocation: callEdge.sourceLocation,
        },
        context: {
          category: "dangling_stack",
          detail: callEdge.target,
        },
      });
    }
  }

  // 8. Unresolved target diagnostic analysis and shadowed target resolution analysis
  for (const edge of allEdges) {
    if (
      (edge.kind === "jump" || edge.kind === "call") &&
      (seenCount.get(edge.target) || 0) > 1
    ) {
      filteredDiagnostics.push({
        code: "shadowed_label",
        severity: "warning",
        message:
          `Edge "${edge.id}" from "${edge.source}" targets label "${edge.target}" which is defined in multiple files and may resolve ambiguously.`,
        recoveryAction:
          "Ensure label names are globally unique across all files.",
        location: {
          edgeId: edge.id,
          sourceId: edge.source,
          targetId: edge.target,
          sourceLocation: edge.sourceLocation,
        },
        context: {
          category: "shadowed_target_resolution",
          detail: edge.target,
        },
      });
    }

    if (
      (edge.kind === "jump" || edge.kind === "call") &&
      !nodeMap.has(edge.target)
    ) {
      filteredDiagnostics.push({
        code: "unresolved_target",
        severity: "warning",
        message: `Edge "${edge.id}" targets unresolved label "${edge.target}".`,
        location: {
          edgeId: edge.id,
          sourceId: edge.source,
          targetId: edge.target,
          sourceLocation: edge.sourceLocation,
        },
        context: {
          category: "missing_edge_target",
          detail: edge.target,
        },
      });
    }
  }

  // 8.5. Cross-file fallthrough analysis
  for (let idx = 0; idx < fragments.length - 1; idx++) {
    const currFrag = fragments[idx]!;
    const nextFrag = fragments[idx + 1]!;
    if (
      currFrag.chapter && nextFrag.chapter &&
      currFrag.chapter === nextFrag.chapter
    ) continue;

    const currLabels = currFrag.nodes.filter((n) => n.type === "LABEL");
    const nextLabels = nextFrag.nodes.filter((n) => n.type === "LABEL");
    if (currLabels.length === 0 || nextLabels.length === 0) continue;

    const lastLabel = currLabels[currLabels.length - 1]!;
    const firstLabel = nextLabels[0]!;

    // Check if lastLabel has an explicit return
    const hasReturn = currFrag.hasReliableReturnInLabel?.has(lastLabel.id) ||
      allReliableReturns.has(lastLabel.id);
    if (hasReturn) continue;

    // Check if lastLabel has any outgoing jump or sequence exit within its file
    const outgoingEdges = currFrag.edges.filter((e) =>
      e.source === lastLabel.id
    );
    const hasExit = outgoingEdges.some(
      (e) => e.kind === "jump" || e.kind === "sequence",
    );
    if (!hasExit) {
      lastLabel.isTerminalOutcome = false;
      filteredDiagnostics.push({
        code: "normalization",
        severity: "warning",
        message: `Label "${lastLabel.id}" in "${
          currFrag.chapter || currFrag.nodes[0]?.chapter || "chapter"
        }" implicitly falls through across files to "${firstLabel.id}" in "${
          nextFrag.chapter || nextFrag.nodes[0]?.chapter || "chapter"
        }". Verify if an explicit jump or return was intended.`,
        location: {
          chapter: currFrag.chapter || currFrag.nodes[0]?.chapter,
          construct: "fallthrough",
          sourceId: lastLabel.id,
          targetId: firstLabel.id,
          sourceLocation: lastLabel.sourceLocation,
        },
        context: {
          category: "cross_file_fallthrough",
          detail: `${lastLabel.id} -> ${firstLabel.id}`,
        },
        recoveryAction:
          "Add an explicit jump or return statement to prevent unintended cross-file fallthrough.",
      });

      const ftEdgeId = `seq_${lastLabel.id}__${firstLabel.id}`;
      if (!edgeIds.has(ftEdgeId)) {
        edgeIds.add(ftEdgeId);
        allEdges.push({
          id: ftEdgeId,
          source: lastLabel.id,
          target: firstLabel.id,
          kind: "fallthrough",
          label: "fallthrough",
          isFallthrough: true,
          sourceLocation: lastLabel.sourceLocation,
        });
      }
    }
  }

  const combinedImageDefinitions = new Map<string, string>();
  for (const frag of fragments) {
    if (frag.imageDefinitions) {
      for (const [k, v] of frag.imageDefinitions) {
        combinedImageDefinitions.set(k, v);
      }
    }
  }

  // 9. Call stack depth warnings
  if (options.maxCallStackDepth !== undefined) {
    analyzeCallStackDepth(
      allNodes,
      allEdges,
      nodeMap,
      options.maxCallStackDepth,
      filteredDiagnostics,
    );
  }

  // 10. Dead state and undeclared conditional variable analysis
  analyzeDeadStateAndUnusedFlags(
    allNodes,
    allEdges,
    allInitDescriptors,
    fragments,
    filteredDiagnostics,
  );

  return {
    nodes: allNodes,
    edges: allEdges,
    diagnostics: filteredDiagnostics,
    initVariables: combinedInitVars,
    imageDefinitions: combinedImageDefinitions,
  };
}

const RENPY_PYTHON_BUILTINS = new Set([
  "renpy",
  "config",
  "persistent",
  "preferences",
  "gui",
  "main_menu",
  "_return",
  "_rollback",
  "_in_replay",
  "_window",
  "_window_during_transitions",
  "_menu",
  "_history",
  "_voice",
  "narrator",
  "adv",
  "nvl",
  "True",
  "False",
  "None",
  "true",
  "false",
  "none",
  "null",
  "len",
  "str",
  "int",
  "float",
  "bool",
  "list",
  "dict",
  "set",
  "tuple",
  "range",
  "min",
  "max",
  "abs",
  "round",
  "hasattr",
  "getattr",
  "setattr",
  "isinstance",
  "issubclass",
  "any",
  "all",
  "zip",
  "enumerate",
  "sorted",
  "reversed",
]);

const RENPY_ENGINE_NAMESPACES = new Set([
  "renpy",
  "config",
  "preferences",
  "gui",
]);

function isBuiltinOrInternalVariable(name: string): boolean {
  if (!name) return true;
  const trimmed = name.trim();
  if (trimmed.startsWith("_")) return true;
  if (
    RENPY_PYTHON_BUILTINS.has(trimmed) ||
    RENPY_PYTHON_BUILTINS.has(trimmed.toLowerCase())
  ) {
    return true;
  }
  const root = trimmed.split(".")[0]!;
  if (
    RENPY_ENGINE_NAMESPACES.has(root) ||
    RENPY_ENGINE_NAMESPACES.has(root.toLowerCase())
  ) {
    return true;
  }
  return false;
}

function extractInterpolationVariables(text: string): string[] {
  if (!text || !text.includes("[")) return [];
  const results: string[] = [];
  const regex = /\[([A-Za-z_][A-Za-z0-9_.]*)\]/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    results.push(m[1]!);
  }
  return results;
}

function analyzeCallStackDepth(
  nodes: FlowNode[],
  edges: FlowEdge[],
  nodeMap: Map<string, FlowNode>,
  maxDepth: number,
  diagnostics: ParseDiagnostic[],
): void {
  const outgoingMap = new Map<string, FlowEdge[]>();
  for (const edge of edges) {
    let list = outgoingMap.get(edge.source);
    if (!list) {
      list = [];
      outgoingMap.set(edge.source, list);
    }
    list.push(edge);
  }

  const entryNodes = new Set<string>();
  if (nodeMap.has("start")) {
    entryNodes.add("start");
  }

  for (const node of nodes) {
    if (node.role === "story") {
      entryNodes.add(node.id);
    }
  }

  const maxDepthSeenAtNode = new Map<string, number>();

  for (const startId of entryNodes) {
    const stack: Array<{ nodeId: string; callStack: string[] }> = [
      { nodeId: startId, callStack: [] },
    ];

    while (stack.length > 0) {
      const { nodeId, callStack } = stack.pop()!;
      const currentDepth = callStack.length;

      const prevMax = maxDepthSeenAtNode.get(nodeId);
      if (prevMax !== undefined && prevMax >= currentDepth) {
        continue;
      }
      maxDepthSeenAtNode.set(nodeId, currentDepth);

      const outgoing = outgoingMap.get(nodeId) ?? [];
      for (const edge of outgoing) {
        if (edge.kind === "call") {
          const nextStack = [...callStack, edge.target];
          if (nextStack.length > maxDepth) {
            const targetNode = nodeMap.get(edge.target);
            const chainDisplay = nextStack
              .map((id) => nodeMap.get(id)?.label ?? id)
              .join(" -> ");
            diagnostics.push({
              code: "normalization",
              severity: "warning",
              location: {
                chapter: targetNode?.chapter,
                construct: "call",
                sourceId: edge.source,
                targetId: edge.target,
                edgeId: edge.id,
                sourceLocation: edge.sourceLocation ??
                  targetNode?.sourceLocation,
              },
              context: {
                category: "excessive_call_depth",
                detail: `${nextStack.length} frames`,
              },
              message:
                `Call stack depth (${nextStack.length}) exceeds safe limit (${maxDepth}): ${chainDisplay}`,
              recoveryAction:
                "Refactor deep subroutine nesting into jumps or ensure returns pop call frames appropriately.",
            });
            continue;
          }
          stack.push({ nodeId: edge.target, callStack: nextStack });
        } else if (edge.kind === "call_return") {
          const nextStack = callStack.length > 0 ? callStack.slice(0, -1) : [];
          stack.push({ nodeId: edge.target, callStack: nextStack });
        } else {
          stack.push({ nodeId: edge.target, callStack });
        }
      }
    }
  }
}

function analyzeDeadStateAndUnusedFlags(
  nodes: FlowNode[],
  edges: FlowEdge[],
  allInitDescriptors: InitVariableDescriptor[],
  fragments: GraphBuildResult[],
  diagnostics: ParseDiagnostic[],
): void {
  const declaredVariables = new Map<
    string,
    {
      chapter?: string;
      sourceId?: string;
      sourceLocation?: FlowNode["sourceLocation"];
    }
  >();

  // 1. Init variables from default/define/$
  for (const desc of allInitDescriptors) {
    const chapter = desc.filePath
      ? desc.filePath.replace(/\\/g, "/").replace(/\.rpy$/i, "")
      : undefined;
    declaredVariables.set(desc.name, { chapter });
  }

  // 2. In-label variable mutations ($ var = ...) and label parameters
  for (const node of nodes) {
    if (node.mutations) {
      for (const m of node.mutations) {
        if (!declaredVariables.has(m.variableName)) {
          declaredVariables.set(m.variableName, {
            chapter: node.chapter,
            sourceId: node.id,
            sourceLocation: node.sourceLocation,
          });
        }
      }
    }
    if (node.parameters) {
      for (const p of node.parameters) {
        declaredVariables.set(p.name, {
          chapter: node.chapter,
          sourceId: node.id,
          sourceLocation: node.sourceLocation,
        });
      }
    }
    if (node.condition?.branchKind === "for" && node.condition.expression) {
      const forMatch = /^([A-Za-z0-9_,\s]+)\s+in\s+(.+)$/.exec(
        node.condition.expression.trim(),
      );
      if (forMatch) {
        const targets = forMatch[1]!.split(",").map((t) => t.trim());
        for (const target of targets) {
          if (target && !declaredVariables.has(target)) {
            declaredVariables.set(target, {
              chapter: node.chapter,
              sourceId: node.id,
              sourceLocation: node.sourceLocation,
            });
          }
        }
      }
    }
  }

  const referencedVariables = new Set<string>();
  const conditionalReferences: Array<{
    varName: string;
    expression: string;
    sourceId?: string;
    edgeId?: string;
    sourceLocation?: FlowNode["sourceLocation"];
    chapter?: string;
  }> = [];

  // Gather python references from fragments
  for (const frag of fragments) {
    if (frag.pythonReferencedVariables) {
      for (const r of frag.pythonReferencedVariables) {
        referencedVariables.add(r);
      }
    }
    if (frag.conditionalExpressions) {
      for (const cond of frag.conditionalExpressions) {
        if (cond.expression) {
          if (cond.branchKind === "for") {
            const forMatch = /^([A-Za-z0-9_,\s]+)\s+in\s+(.+)$/.exec(
              cond.expression.trim(),
            );
            if (forMatch) {
              const targets = forMatch[1]!.split(",").map((t) => t.trim());
              for (const target of targets) {
                if (target && !declaredVariables.has(target)) {
                  declaredVariables.set(target, {
                    chapter: cond.chapter,
                    sourceId: cond.sourceId,
                    sourceLocation: cond.sourceLocation,
                  });
                }
              }
              const rhsRefs = extractConditionFlagRefs(forMatch[2]);
              for (const r of rhsRefs) {
                referencedVariables.add(r);
                conditionalReferences.push({
                  varName: r,
                  expression: cond.expression,
                  sourceId: cond.sourceId,
                  sourceLocation: cond.sourceLocation,
                  chapter: cond.chapter,
                });
              }
              continue;
            }
          }

          const refs = extractConditionFlagRefs(cond.expression);
          for (const r of refs) {
            referencedVariables.add(r);
            conditionalReferences.push({
              varName: r,
              expression: cond.expression,
              sourceId: cond.sourceId,
              sourceLocation: cond.sourceLocation,
              chapter: cond.chapter,
            });
          }
        }
      }
    }
  }

  // Gather references from edge conditions & edge labels
  for (const edge of edges) {
    if (edge.condition?.expression) {
      if (edge.condition.branchKind === "for") {
        const forMatch = /^([A-Za-z0-9_,\s]+)\s+in\s+(.+)$/.exec(
          edge.condition.expression.trim(),
        );
        if (forMatch) {
          const targets = forMatch[1]!.split(",").map((t) => t.trim());
          for (const target of targets) {
            if (target && !declaredVariables.has(target)) {
              declaredVariables.set(target, {
                sourceId: edge.source,
                sourceLocation: edge.sourceLocation,
              });
            }
          }
          const rhsRefs = extractConditionFlagRefs(forMatch[2]);
          for (const r of rhsRefs) {
            referencedVariables.add(r);
            conditionalReferences.push({
              varName: r,
              expression: edge.condition.expression,
              sourceId: edge.source,
              edgeId: edge.id,
              sourceLocation: edge.sourceLocation,
            });
          }
          continue;
        }
      }

      const refs = extractConditionFlagRefs(edge.condition.expression);
      for (const r of refs) {
        referencedVariables.add(r);
        conditionalReferences.push({
          varName: r,
          expression: edge.condition.expression,
          sourceId: edge.source,
          edgeId: edge.id,
          sourceLocation: edge.sourceLocation,
        });
      }
    }
    if (edge.label) {
      for (const interp of extractInterpolationVariables(edge.label)) {
        referencedVariables.add(interp);
      }
    }
  }

  // Gather references from node conditions and dialogue
  for (const node of nodes) {
    if (node.condition?.expression) {
      const refs = extractConditionFlagRefs(node.condition.expression);
      for (const r of refs) {
        referencedVariables.add(r);
        conditionalReferences.push({
          varName: r,
          expression: node.condition.expression,
          sourceId: node.id,
          sourceLocation: node.sourceLocation,
          chapter: node.chapter,
        });
      }
    }
    if (node.label) {
      for (const interp of extractInterpolationVariables(node.label)) {
        referencedVariables.add(interp);
      }
    }
    if (node.dialogueLines) {
      for (const line of node.dialogueLines) {
        for (const interp of extractInterpolationVariables(line)) {
          referencedVariables.add(interp);
        }
      }
    }
    if (node.mutations) {
      for (const m of node.mutations) {
        if (m.rawExpression) {
          for (const r of extractConditionFlagRefs(m.rawExpression)) {
            if (r !== m.variableName) {
              referencedVariables.add(r);
            }
          }
        }
      }
    }
  }

  // Gather references from init expressions (RHS)
  for (const desc of allInitDescriptors) {
    if (desc.rawExpression) {
      for (const r of extractConditionFlagRefs(desc.rawExpression)) {
        if (r !== desc.name) {
          referencedVariables.add(r);
        }
      }
    }
  }

  // Check for unused variables/flags
  for (const [varName, loc] of declaredVariables.entries()) {
    if (isBuiltinOrInternalVariable(varName)) continue;
    const isReferenced = referencedVariables.has(varName) ||
      referencedVariables.has(`persistent.${varName}`) ||
      (varName.startsWith("persistent.") &&
        referencedVariables.has(varName.slice("persistent.".length)));

    if (!isReferenced) {
      diagnostics.push({
        code: "normalization",
        severity: "warning",
        location: {
          chapter: loc.chapter,
          construct: "variable",
          sourceId: loc.sourceId,
          sourceLocation: loc.sourceLocation,
        },
        context: {
          category: "unused_variable",
          detail: varName,
        },
        message:
          `Variable/flag "${varName}" is declared or initialized but never evaluated in any conditional statement or dialogue.`,
        recoveryAction:
          "Remove the unused variable or verify if a conditional check or dialogue interpolation was intended.",
      });
    }
  }

  // Check for undeclared conditional variables
  for (const condRef of conditionalReferences) {
    if (isBuiltinOrInternalVariable(condRef.varName)) continue;
    const isDeclared = declaredVariables.has(condRef.varName) ||
      declaredVariables.has(`persistent.${condRef.varName}`) ||
      (condRef.varName.startsWith("persistent.") &&
        declaredVariables.has(condRef.varName.slice("persistent.".length)));

    if (!isDeclared) {
      diagnostics.push({
        code: "normalization",
        severity: "warning",
        location: {
          chapter: condRef.chapter,
          construct: "condition",
          sourceId: condRef.sourceId,
          edgeId: condRef.edgeId,
          targetExpression: condRef.expression,
          sourceLocation: condRef.sourceLocation,
        },
        context: {
          category: "undeclared_variable",
          detail: condRef.varName,
        },
        message:
          `Variable "${condRef.varName}" is evaluated in conditional expression ("${condRef.expression}") but is never assigned or declared in default/define blocks.`,
        recoveryAction:
          "Declare the variable using a default or define statement or assign it before evaluation.",
      });
    }
  }
}
