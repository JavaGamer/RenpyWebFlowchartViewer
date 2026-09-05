import type { ParseGraphState, ParseScanState } from "../pipelineTypes.ts";
import {
  addEdge,
  addIncoming,
  addNode,
  addOutgoing,
} from "../graphMutations.ts";
import { addParseDiagnostic } from "../diagnostics.ts";
import { menuHasFallthrough } from "../handlers/menuHandler.ts";
import {
  areAllPathsCoveredByPendingMenus,
  edgeIdWithOption,
} from "../scanTransitions.ts";
import { parseLabelParameters } from "../handlers/jumpCallHandler.ts";
import type { SourceLocation } from "../../domain/index.ts";

export function handleKwLabelToken(
  scanState: ParseScanState,
  sourceLocation?: SourceLocation,
): void {
  scanState.waitForLabelName = true;
  scanState.currentLabelStartLoc = sourceLocation ?? null;
  if (scanState.labelHasExplicitExit) {
    scanState.pendingMenuFallthrough = [];
  } else {
    for (const openMenu of scanState.menuStack) {
      if (menuHasFallthrough(openMenu)) {
        const fallthroughOptions = openMenu.options?.filter((o) =>
          !o.hasExit
        ) ?? [];
        if (fallthroughOptions.length > 0) {
          for (const opt of fallthroughOptions) {
            scanState.pendingMenuFallthrough.push({
              menuId: openMenu.id,
              optionText: opt.text,
              sourceLocation: openMenu.sourceLocation ?? sourceLocation,
              decisionNodeId: openMenu.decisionNodeId,
              calledTargetId: opt.calledTargetId,
              callContextId: opt.callContextId,
            });
          }
        } else {
          scanState.pendingMenuFallthrough.push({
            menuId: openMenu.id,
            optionText: null,
            sourceLocation: openMenu.sourceLocation ?? sourceLocation,
            decisionNodeId: openMenu.decisionNodeId,
          });
        }
      }
    }
  }
  scanState.menuStack.length = 0;
  scanState.conditionalIndentStack.length = 0;
  scanState.conditionalDecisionStack.length = 0;
  scanState.pendingConditionalHeader = null;
  scanState.waitForJumpTarget = false;
  scanState.waitForJumpExpressionTarget = false;
  scanState.waitForCallTarget = false;
  scanState.waitForMenuNameForId = null;
}

export function handleLabelNameToken(
  state: ParseGraphState,
  scanState: ParseScanState,
  declaredLabelName: string,
  chapter: string,
  lineIndent: number,
  lineText: string,
  sourceLocation?: SourceLocation,
): void {
  let qualifiedLabelName = declaredLabelName;
  if (declaredLabelName.startsWith(".")) {
    const parentGlobal = scanState.currentGlobalLabelDeclaredName ?? "";
    if (parentGlobal) {
      qualifiedLabelName = `${parentGlobal}${declaredLabelName}`;
    }
  } else {
    scanState.currentGlobalLabelDeclaredName = declaredLabelName;
    scanState.currentGlobalLabelIndent = lineIndent;
  }

  let newLabelId =
    state.labelsByChapter.get(chapter)?.get(qualifiedLabelName) ??
      state.labelsByChapter.get(chapter)?.get(declaredLabelName);
  let definitionCount: number;
  let canonicalLabelId: string;

  if (newLabelId) {
    definitionCount =
      state.labelDefinitionCountByName.get(qualifiedLabelName) ??
        1;
    canonicalLabelId = state.canonicalLabelIdByName.get(qualifiedLabelName) ??
      qualifiedLabelName;
  } else {
    definitionCount =
      (state.labelDefinitionCountByName.get(qualifiedLabelName) ?? 0) + 1;
    state.labelDefinitionCountByName.set(qualifiedLabelName, definitionCount);
    canonicalLabelId = state.canonicalLabelIdByName.get(qualifiedLabelName) ??
      qualifiedLabelName;
    state.canonicalLabelIdByName.set(qualifiedLabelName, canonicalLabelId);
    if (declaredLabelName !== qualifiedLabelName) {
      state.canonicalLabelIdByName.set(declaredLabelName, canonicalLabelId);
    }
    newLabelId = definitionCount === 1
      ? canonicalLabelId
      : `${canonicalLabelId}__shadow_${definitionCount}`;
    let chapterLabels = state.labelsByChapter.get(chapter);
    if (!chapterLabels) {
      chapterLabels = new Map();
      state.labelsByChapter.set(chapter, chapterLabels);
    }
    chapterLabels.set(qualifiedLabelName, newLabelId);
    chapterLabels.set(declaredLabelName, newLabelId);
  }

  const allCoveredByMenus = areAllPathsCoveredByPendingMenus(
    state,
    scanState,
  );

  if (
    scanState.currentLabelId !== null &&
    !scanState.labelHasExplicitExit &&
    scanState.menuStack.length === 0 &&
    !allCoveredByMenus
  ) {
    addEdge(state, {
      id: `seq_${scanState.currentLabelId}__${newLabelId}`,
      source: scanState.currentLabelId,
      target: newLabelId,
      kind: "sequence",
      label: "next",
      sourceLocation,
    });
    addOutgoing(state, scanState.currentLabelId, "sequence");
    addIncoming(state, newLabelId, "sequence");
  }

  scanState.currentLabelId = newLabelId;
  scanState.currentLabelBaseId = newLabelId;
  scanState.currentLabelDeclaredName = declaredLabelName;
  scanState.currentLabelSceneIndex = 1;
  scanState.currentLabelHasSplit = false;
  scanState.currentLabelHasContentSinceSceneBoundary = false;
  scanState.currentLabelIndent = lineIndent;
  scanState.currentSceneDialogueCount = 0;
  scanState.labelVariableLiteralTargets.clear();
  scanState.labelVariableDictTargets.clear();
  scanState.labelVariableListTargets.clear();

  if (!scanState.labelHasExplicitExit) {
    const connectedFallthroughKeys = new Set<string>();
    for (const entry of scanState.pendingMenuFallthrough) {
      if (entry.calledTargetId) continue;
      const key = `${entry.menuId}__${entry.optionText ?? ""}`;
      if (!connectedFallthroughKeys.has(key)) {
        addEdge(state, {
          id: edgeIdWithOption(
            `seq_${entry.menuId}__${newLabelId}`,
            entry.optionText ?? null,
          ),
          source: entry.menuId,
          target: newLabelId,
          kind: "sequence",
          label: entry.optionText ??
            (entry.menuId.startsWith("decision_") ? "else" : "next"),
          condition: entry.menuId.startsWith("decision_")
            ? {
              branchKind: "else",
              decisionNodeId: entry.menuId,
            }
            : undefined,
          sourceLocation,
        });
        addOutgoing(state, entry.menuId, "sequence");
        addIncoming(state, newLabelId, "sequence");
        connectedFallthroughKeys.add(key);
      }
    }
  }
  scanState.pendingMenuFallthrough = [];
  state.allLabelIds.add(newLabelId);
  scanState.labelHasExplicitExit = false;
  scanState.waitForLabelName = false;

  const labelSourceLocation = scanState.currentLabelStartLoc && sourceLocation
    ? {
      file: sourceLocation.file,
      start: scanState.currentLabelStartLoc.start,
      end: sourceLocation.end,
    }
    : sourceLocation;

  const parameters = parseLabelParameters(lineText);

  addNode(state, {
    id: newLabelId,
    type: "LABEL",
    label: declaredLabelName,
    dialogueCount: 0,
    chapter,
    isShadowed: definitionCount > 1,
    shadowOfId: definitionCount > 1 ? canonicalLabelId : undefined,
    sourceLocation: labelSourceLocation,
    parameters,
  });

  if (definitionCount > 1 && canonicalLabelId) {
    const diagnosticId =
      `shadowed_label|${chapter}|${declaredLabelName}|${newLabelId}|${canonicalLabelId}`;
    addParseDiagnostic(
      state,
      {
        code: "shadowed_label",
        severity: "warning",
        location: {
          chapter,
          construct: "label",
          sourceId: newLabelId,
          targetId: canonicalLabelId,
          sourceLocation: labelSourceLocation,
        },
        context: {
          category: "shadowed_label",
          detail: declaredLabelName,
        },
        message:
          `Label "${declaredLabelName}" is a duplicate definition and is shadowed by canonical label "${canonicalLabelId}".`,
        recoveryAction:
          "Rename duplicate labels or keep one canonical definition.",
      },
      diagnosticId,
    );
  }
}
