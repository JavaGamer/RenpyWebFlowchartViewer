import type { ParseGraphState } from "../pipelineTypes.ts";
import { addParseDiagnostic } from "../diagnostics.ts";
import { extractConditionFlagRefs } from "../../domain/index.ts";
import {
  extractInterpolationVariables,
  isBuiltinOrInternalVariable,
} from "./cfaHelpers.ts";

export function analyzeDeadStateAndUnusedFlags(state: ParseGraphState): void {
  const declaredVariables = new Map<
    string,
    {
      chapter?: string;
      sourceId?: string;
      sourceLocation?: ParseGraphState["nodes"][0]["sourceLocation"];
    }
  >();

  // 1. Gather variables declared in define / default / top-level $
  if (state.initVariables) {
    for (const [varName, desc] of state.initVariables.entries()) {
      const chapter = desc.filePath
        ? desc.filePath.replace(/\\/g, "/").replace(/\.rpy$/i, "")
        : undefined;
      declaredVariables.set(varName, { chapter });
    }
  }

  if (state.globalCharacters) {
    for (const charName of state.globalCharacters) {
      if (!declaredVariables.has(charName)) {
        declaredVariables.set(
          charName,
          { construct: "character" } as unknown as { chapter?: string },
        );
      }
    }
  }

  // 2. Gather in-label variable mutations ($ var = ...)
  if (state.nodeMutations) {
    for (const [nodeId, mutations] of state.nodeMutations.entries()) {
      const node = state.nodeMap.get(nodeId);
      for (const m of mutations) {
        if (!declaredVariables.has(m.variableName)) {
          declaredVariables.set(m.variableName, {
            chapter: node?.chapter,
            sourceId: nodeId,
            sourceLocation: node?.sourceLocation,
          });
        }
      }
    }
  }

  // 3. Gather label parameters (e.g. label my_label(param1, param2=0):)
  for (const node of state.nodes) {
    if (node.parameters) {
      for (const p of node.parameters) {
        declaredVariables.set(p.name, {
          chapter: node.chapter,
          sourceId: node.id,
          sourceLocation: node.sourceLocation,
        });
      }
    }
  }

  const referencedVariables = new Set<string>();
  const conditionalReferences: Array<{
    varName: string;
    expression: string;
    sourceId?: string;
    edgeId?: string;
    sourceLocation?: ParseGraphState["nodes"][0]["sourceLocation"];
    chapter?: string;
  }> = [];

  // 4. Gather variable references from all parsed conditional expressions (if, elif, while, for, python)
  if (state.allConditionalExpressions) {
    for (const cond of state.allConditionalExpressions) {
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

  // 5. Gather variable references from edge conditions & edge labels
  for (const edge of state.edges) {
    if (edge.condition?.expression) {
      const refs = extractConditionFlagRefs(edge.condition.expression);
      const sourceNode = state.nodeMap.get(edge.source);
      for (const r of refs) {
        referencedVariables.add(r);
        conditionalReferences.push({
          varName: r,
          expression: edge.condition.expression,
          sourceId: edge.source,
          edgeId: edge.id,
          sourceLocation: edge.sourceLocation ?? sourceNode?.sourceLocation,
          chapter: sourceNode?.chapter,
        });
      }
    }
    if (edge.label) {
      const interpolations = extractInterpolationVariables(edge.label);
      for (const interp of interpolations) {
        referencedVariables.add(interp);
      }
    }
  }

  // 6. Gather variable references from node conditions and dialogue
  for (const node of state.nodes) {
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
      const interpolations = extractInterpolationVariables(node.label);
      for (const interp of interpolations) {
        referencedVariables.add(interp);
      }
    }
    if (node.dialogueLines) {
      for (const line of node.dialogueLines) {
        const interpolations = extractInterpolationVariables(line);
        for (const interp of interpolations) {
          referencedVariables.add(interp);
        }
      }
    }
  }

  // 7. Gather variable references from mutation expressions and init expressions (RHS)
  if (state.nodeMutations) {
    for (const mutations of state.nodeMutations.values()) {
      for (const m of mutations) {
        if (m.rawExpression) {
          const refs = extractConditionFlagRefs(m.rawExpression);
          for (const r of refs) {
            referencedVariables.add(r);
          }
        }
      }
    }
  }
  if (state.initVariables) {
    for (const desc of state.initVariables.values()) {
      if (desc.rawExpression) {
        const refs = extractConditionFlagRefs(desc.rawExpression);
        for (const r of refs) {
          referencedVariables.add(r);
        }
      }
    }
  }

  // 8. Check for unused variables/flags
  const speakingCharacters = new Set<string>();
  for (const node of state.nodes) {
    if (node.characterDialogue) {
      for (const charId of Object.keys(node.characterDialogue)) {
        if (charId) speakingCharacters.add(charId);
      }
    }
  }
  for (const [varName, loc] of declaredVariables.entries()) {
    if (isBuiltinOrInternalVariable(varName)) continue;
    if (varName.includes(".") && !varName.startsWith("persistent.")) {
      const rootObj = varName.split(".")[0]!;
      if (
        state.globalCharacters?.has(rootObj) ||
        speakingCharacters.has(rootObj) ||
        varName.endsWith(".name")
      ) {
        continue;
      }
    }
    const isReferenced = referencedVariables.has(varName) ||
      referencedVariables.has(`persistent.${varName}`) ||
      (varName.startsWith("persistent.") &&
        referencedVariables.has(varName.slice("persistent.".length)));

    if (!isReferenced) {
      addParseDiagnostic(
        state,
        {
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
        },
        `unused_variable|${varName}`,
      );
    }
  }

  // 9. Check for undeclared conditional variables
  for (const condRef of conditionalReferences) {
    if (isBuiltinOrInternalVariable(condRef.varName)) continue;
    const isDeclared = declaredVariables.has(condRef.varName) ||
      declaredVariables.has(`persistent.${condRef.varName}`) ||
      (condRef.varName.startsWith("persistent.") &&
        declaredVariables.has(condRef.varName.slice("persistent.".length)));

    if (!isDeclared) {
      addParseDiagnostic(
        state,
        {
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
        },
        `undeclared_variable|${condRef.varName}|${condRef.expression}|${
          condRef.sourceId ?? ""
        }`,
      );
    }
  }
}
