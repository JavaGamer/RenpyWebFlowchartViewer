import { isMenuKeywordTokenType, PARSER_TOKENS } from "./parserTokens.ts";
import {
  extractPlayCue,
  extractQueueCue,
  extractSceneAsset,
  extractShowAsset,
  extractStopCue,
  extractVoiceCue,
} from "./handlers/audioCues.ts";
import type {
  ParseGraphState,
  ParseScanState,
  TokenMetaFlags,
} from "./pipelineTypes.ts";
import { menuAtDepth, parentMenuStackLength } from "./scanTransitions.ts";
import {
  addEdge,
  addIncoming,
  addNode,
  addOutgoing,
} from "./graphMutations.ts";
import { assertInvariant } from "./pipelineInvariants.ts";
import { addParseDiagnostic } from "./diagnostics.ts";
import { menuHasFallthrough } from "./handlers/menuHandler.ts";
import {
  isWithinCurrentLabelScope,
  splitCurrentLabelOnSceneBoundary,
} from "./handlers/labelHandler.ts";
import {
  addDynamicTargetDiagnostic,
  emitCallEdge,
  emitJumpEdge,
  resolveCallContext,
  resolveExpressionTargets,
} from "./handlers/jumpCallHandler.ts";
import { handleConditionalHeader } from "./handlers/conditionHandler.ts";
import {
  processDirectRenpyBlockCalls,
  processDirectScreenActionCalls,
  resetStaleWaitFlags,
} from "./handlers/screen/screenHandlerEntry.ts";
import type { ScreenActionKind } from "../config/parserRules.ts";

export {
  extractLiteralTarget,
  parseDictLiteral,
  parseListLiteral,
  resolveStaticTargetExpression,
} from "./handlers/jumpCallHandler.ts";
export { stripInlineComment } from "./handlers/screen/screenHandlerEntry.ts";

/**
 * Computes word count and explicit pause duration from a Ren'Py dialogue line.
 *
 * Word count: Strips all curly-brace Ren'Py text tags (e.g. {b}, {w=1.5},
 * {/i}) before splitting on whitespace so only spoken words are counted.
 *
 * Pause duration: Only tags with an explicit numeric argument are counted
 * (e.g. {w=2.5} or {p=1.0} contributes their duration in seconds). Plain
 * {w} / {p} (click-to-continue pauses) contribute 0 seconds.
 */
export function computeTextStats(
  text: string,
): { wordCount: number; pauseDuration: number } {
  // Extract explicit pause durations: {w=N} or {p=N}
  let pauseDuration = 0;
  const pausePattern = /\{[wp]=([0-9]+(?:\.[0-9]*)?)\}/g;
  let match: RegExpExecArray | null;
  while ((match = pausePattern.exec(text)) !== null) {
    pauseDuration += parseFloat(match[1]!);
  }

  // Strip all Ren'Py text tags to count words (including alpha tags, wait, etc.)
  const stripped = text.replace(/\{[^}]*\}/g, "");
  const wordCount = stripped.trim() === ""
    ? 0
    : stripped.trim().split(/\s+/).length;

  return { wordCount, pauseDuration };
}

interface HandleTokenInput {
  type: number;
  meta: TokenMetaFlags;
  val: () => string;
  chapter: string;
  menuDepth: number;
  lineIndent: number;
  lineText: string;
  lineNum: number;
  captureDialogueLines: boolean;
  screenActionRuleMap: Map<string, ScreenActionKind>;
  sceneSplitDialogueThreshold?: number;
}

export function ensureScanStateInitialized(scanState: ParseScanState): void {
  if (!scanState.conditionalDecisionStack) {
    scanState.conditionalDecisionStack = [];
  }
  if (!scanState.labelVariableLiteralTargets) {
    scanState.labelVariableLiteralTargets = new Map();
  }
  if (!scanState.labelVariableDictTargets) {
    scanState.labelVariableDictTargets = new Map();
  }
  if (!scanState.labelVariableListTargets) {
    scanState.labelVariableListTargets = new Map();
  }
  if (scanState.pendingConditionalHeader === undefined) {
    scanState.pendingConditionalHeader = null;
  }
  if (scanState.currentLabelDeclaredName === undefined) {
    scanState.currentLabelDeclaredName = null;
  }
  if (scanState.currentLabelBaseId === undefined) {
    scanState.currentLabelBaseId = null;
  }
  if (scanState.currentLabelSceneIndex === undefined) {
    scanState.currentLabelSceneIndex = 1;
  }
  if (scanState.currentLabelHasSplit === undefined) {
    scanState.currentLabelHasSplit = false;
  }
  if (scanState.currentLabelHasContentSinceSceneBoundary === undefined) {
    scanState.currentLabelHasContentSinceSceneBoundary = false;
  }
}

/**
 * The main dispatch router for individual tokens in the parser pipeline.
 * Evaluates token types (labels, jumps, calls, returns, menus, dialogue strings)
 * and mutates the flowchart graph topology accordingly.
 */
export function handleToken(
  state: ParseGraphState,
  scanState: ParseScanState,
  input: HandleTokenInput,
): void {
  if (
    !scanState.labelVariableDictTargets || !scanState.conditionalDecisionStack
  ) {
    ensureScanStateInitialized(scanState);
  }
  const {
    type,
    meta,
    val,
    chapter,
    menuDepth,
    lineIndent,
    lineText,
    lineNum,
    captureDialogueLines,
    screenActionRuleMap,
  } = input;
  resetStaleWaitFlags(scanState, type);

  if (
    scanState.currentLabelId !== null &&
    lineNum !== scanState.lastProcessedCustomLineNum
  ) {
    const trimmed = lineText.trim();
    const timedChoiceMatch =
      /^timedchoice\s+([0-9]+(?:\.[0-9]+)?|\.[0-9]+)\s+([a-zA-Z0-9_]+)/i.exec(
        trimmed,
      );
    if (timedChoiceMatch) {
      scanState.lastProcessedCustomLineNum = lineNum;
      const durationSeconds = parseFloat(timedChoiceMatch[1]);
      const target = timedChoiceMatch[2];
      const context = resolveCallContext(scanState, meta, menuDepth);
      const timeout = {
        isTimeout: true as const,
        durationSeconds,
      };
      emitJumpEdge(state, scanState, target, context, false, timeout);
    } else if (/^gameover\b/i.test(trimmed)) {
      scanState.lastProcessedCustomLineNum = lineNum;
      scanState.labelHasExplicitExit = true;
    }
  }

  if (type === PARSER_TOKENS.kwLabel && meta.hasLabelStatement) {
    scanState.waitForLabelName = true;
    scanState.pendingMenuFallthroughIds = [];
    for (const openMenu of scanState.menuStack) {
      if (menuHasFallthrough(openMenu)) {
        scanState.pendingMenuFallthroughIds.push(openMenu.id);
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
    return;
  }

  const isLabelNameToken =
    type === PARSER_TOKENS.entityFunctionName ||
    (PARSER_TOKENS.entityIdentifier !== undefined &&
      type === PARSER_TOKENS.entityIdentifier) ||
    (PARSER_TOKENS.kwOther !== undefined && type === PARSER_TOKENS.kwOther);

  if (
    isLabelNameToken &&
    scanState.waitForLabelName &&
    meta.hasLabelStatement
  ) {
    const labelMatch = /^\s*label\s+(\.?[A-Za-z_][A-Za-z0-9_]*)/i.exec(lineText);
    const rawDeclaredLabelName = labelMatch ? labelMatch[1] : val().trim();
    if (!rawDeclaredLabelName || rawDeclaredLabelName === ".") return;

    const isSub = rawDeclaredLabelName.startsWith(".");
    let declaredLabelName = rawDeclaredLabelName;
    if (isSub && scanState.currentParentLabel) {
      declaredLabelName = `${scanState.currentParentLabel}${rawDeclaredLabelName}`;
    } else if (!isSub) {
      scanState.currentParentLabel = rawDeclaredLabelName;
    }

    const definitionCount =
      (state.labelDefinitionCountByName.get(declaredLabelName) ?? 0) + 1;
    state.labelDefinitionCountByName.set(declaredLabelName, definitionCount);
    const canonicalLabelId =
      state.canonicalLabelIdByName.get(declaredLabelName) ?? declaredLabelName;
    state.canonicalLabelIdByName.set(declaredLabelName, canonicalLabelId);
    const newLabelId = definitionCount === 1
      ? canonicalLabelId
      : `${canonicalLabelId}__shadow_${definitionCount}`;
    if (
      scanState.currentLabelId !== null &&
      !scanState.labelHasExplicitExit &&
      scanState.menuStack.length === 0
    ) {
      addEdge(state, {
        id: `seq_${scanState.currentLabelId}__${newLabelId}`,
        source: scanState.currentLabelId,
        target: newLabelId,
        kind: "sequence",
        label: "next",
      });
      addOutgoing(state, scanState.currentLabelId, "sequence");
      addIncoming(state, newLabelId, "sequence");
    }

    scanState.currentLabelId = newLabelId;
    scanState.currentLabelBaseId = newLabelId;
    scanState.currentLabelDeclaredName = rawDeclaredLabelName;
    scanState.currentLabelSceneIndex = 1;
    scanState.currentLabelHasSplit = false;
    scanState.currentLabelHasContentSinceSceneBoundary = false;
    scanState.currentLabelIndent = lineIndent;
    scanState.currentSceneDialogueCount = 0;
    scanState.labelVariableLiteralTargets.clear();
    scanState.labelVariableDictTargets.clear();
    scanState.labelVariableListTargets.clear();
    for (const menuId of scanState.pendingMenuFallthroughIds) {
      addEdge(state, {
        id: `seq_${menuId}__${newLabelId}`,
        source: menuId,
        target: newLabelId,
        kind: "sequence",
        label: "next",
      });
      addOutgoing(state, menuId, "sequence");
      addIncoming(state, newLabelId, "sequence");
    }
    scanState.pendingMenuFallthroughIds = [];
    state.allLabelIds.add(newLabelId);
    scanState.labelHasExplicitExit = false;
    scanState.waitForLabelName = false;

    addNode(state, {
      id: newLabelId,
      type: "LABEL",
      label: rawDeclaredLabelName,
      dialogueCount: 0,
      chapter,
      isShadowed: definitionCount > 1,
      shadowOfId: definitionCount > 1 ? canonicalLabelId : undefined,
      isSubLabel: isSub,
      parentLabelScope: isSub ? (scanState.currentParentLabel ?? undefined) : undefined,
    });
    if (definitionCount > 1) {
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
    return;
  }

  if (!isWithinCurrentLabelScope(scanState, meta, lineIndent)) {
    return;
  }

  if (type === PARSER_TOKENS.metaScreenBlock) {
    scanState.currentLabelHasContentSinceSceneBoundary = true;
    processDirectScreenActionCalls(
      state,
      scanState,
      meta,
      chapter,
      menuDepth,
      val(),
      screenActionRuleMap,
    );
    return;
  }

  if (PARSER_TOKENS.kwScene !== undefined && type === PARSER_TOKENS.kwScene) {
    splitCurrentLabelOnSceneBoundary(
      state,
      scanState,
      chapter,
      meta,
      menuDepth,
      input.sceneSplitDialogueThreshold,
    );
    if (scanState.currentLabelId) {
      const ownerNode = state.nodeMap.get(scanState.currentLabelId);
      if (ownerNode) {
        const sceneAsset = extractSceneAsset(lineText);
        if (sceneAsset) {
          if (!ownerNode.audioAssetCues) ownerNode.audioAssetCues = [];
          ownerNode.audioAssetCues.push({
            type: "scene",
            asset: sceneAsset,
            raw: lineText.trim(),
            lineNum,
          });
        }
      }
    }
    return;
  }

  if (PARSER_TOKENS.kwShow !== undefined && type === PARSER_TOKENS.kwShow) {
    if (scanState.currentLabelId) {
      const ownerNode = state.nodeMap.get(scanState.currentLabelId);
      if (ownerNode) {
        const showAsset = extractShowAsset(lineText);
        if (showAsset) {
          if (!ownerNode.audioAssetCues) ownerNode.audioAssetCues = [];
          ownerNode.audioAssetCues.push({
            type: "show",
            asset: showAsset,
            raw: lineText.trim(),
            lineNum,
          });
        }
      }
    }
    return;
  }

  if (PARSER_TOKENS.kwPlay !== undefined && type === PARSER_TOKENS.kwPlay) {
    scanState.currentLabelHasContentSinceSceneBoundary = true;
    if (scanState.currentLabelId) {
      const ownerNode = state.nodeMap.get(scanState.currentLabelId);
      if (ownerNode) {
        const cue = extractPlayCue(lineText);
        if (cue) {
          if (!ownerNode.audioAssetCues) ownerNode.audioAssetCues = [];
          ownerNode.audioAssetCues.push({
            type: "play",
            channel: cue.channel,
            asset: cue.asset,
            raw: lineText.trim(),
            lineNum,
          });
        }
      }
    }
    return;
  }

  if (PARSER_TOKENS.kwStop !== undefined && type === PARSER_TOKENS.kwStop) {
    scanState.currentLabelHasContentSinceSceneBoundary = true;
    if (scanState.currentLabelId) {
      const ownerNode = state.nodeMap.get(scanState.currentLabelId);
      if (ownerNode) {
        const cue = extractStopCue(lineText);
        if (cue) {
          if (!ownerNode.audioAssetCues) ownerNode.audioAssetCues = [];
          ownerNode.audioAssetCues.push({
            type: "stop",
            channel: cue.channel,
            asset: cue.asset ?? "",
            raw: lineText.trim(),
            lineNum,
          });
        }
      }
    }
    return;
  }

  if (PARSER_TOKENS.kwQueue !== undefined && type === PARSER_TOKENS.kwQueue) {
    scanState.currentLabelHasContentSinceSceneBoundary = true;
    if (scanState.currentLabelId) {
      const ownerNode = state.nodeMap.get(scanState.currentLabelId);
      if (ownerNode) {
        const cue = extractQueueCue(lineText);
        if (cue) {
          if (!ownerNode.audioAssetCues) ownerNode.audioAssetCues = [];
          ownerNode.audioAssetCues.push({
            type: "queue",
            channel: cue.channel,
            asset: cue.asset,
            raw: lineText.trim(),
            lineNum,
          });
        }
      }
    }
    return;
  }

  const isVoiceToken =
    (PARSER_TOKENS.kwVoice !== undefined && type === PARSER_TOKENS.kwVoice) ||
    (PARSER_TOKENS.kwOther !== undefined && type === PARSER_TOKENS.kwOther &&
      val().trim().toLowerCase() === "voice");

  if (isVoiceToken) {
    scanState.currentLabelHasContentSinceSceneBoundary = true;
    if (scanState.currentLabelId) {
      const ownerNode = state.nodeMap.get(scanState.currentLabelId);
      if (ownerNode) {
        const voiceAsset = extractVoiceCue(lineText);
        if (voiceAsset) {
          if (!ownerNode.audioAssetCues) ownerNode.audioAssetCues = [];
          ownerNode.audioAssetCues.push({
            type: "voice",
            asset: voiceAsset,
            raw: lineText.trim(),
            lineNum,
          });
        }
      }
    }
    return;
  }

  if (type === PARSER_TOKENS.kwConditional) {
    if (handleConditionalHeader(state, scanState, meta, menuDepth, chapter)) {
      scanState.currentLabelHasContentSinceSceneBoundary = true;
    }
  }

  if (
    PARSER_TOKENS.kwDollarSign !== undefined &&
    type === PARSER_TOKENS.kwDollarSign
  ) {
    scanState.currentLabelHasContentSinceSceneBoundary = true;
    const rawText = lineText.trim();
    const cleanStmt = rawText.startsWith("$")
      ? rawText.slice(1).trim()
      : rawText;
    processDirectRenpyBlockCalls(
      state,
      scanState,
      meta,
      chapter,
      menuDepth,
      cleanStmt,
    );
    return;
  }

  if (type === PARSER_TOKENS.metaPythonBlock) {
    scanState.currentLabelHasContentSinceSceneBoundary = true;
    processDirectRenpyBlockCalls(
      state,
      scanState,
      meta,
      chapter,
      menuDepth,
      val(),
    );
    return;
  }

  if (scanState.currentLabelId === null) return;

  if (isMenuKeywordTokenType(type) && meta.hasMenuStatement) {
    scanState.currentLabelHasContentSinceSceneBoundary = true;
    const poppedMenus: typeof scanState.menuStack = [];
    while (scanState.menuStack.length > parentMenuStackLength(menuDepth)) {
      const closedMenu = scanState.menuStack.pop();
      if (closedMenu) poppedMenus.push(closedMenu);
    }

    state.menuCounter += 1;
    const newMenuId = `menu_${state.menuCounter}`;
    scanState.waitForMenuNameForId = newMenuId;
    addNode(state, {
      id: newMenuId,
      type: "MENU",
      label: newMenuId,
      dialogueCount: 0,
      chapter,
      parentLabelId: scanState.currentLabelId,
    });
    for (const closedMenu of poppedMenus) {
      if (!menuHasFallthrough(closedMenu)) continue;
      addEdge(state, {
        id: `seq_${closedMenu.id}__${newMenuId}`,
        source: closedMenu.id,
        target: newMenuId,
        kind: "sequence",
        label: "next",
      });
      addOutgoing(state, closedMenu.id, "sequence");
      addIncoming(state, newMenuId, "sequence");
    }

    const parentMenu = scanState.menuStack[scanState.menuStack.length - 1];
    const decisionContext = scanState
      .conditionalDecisionStack[
        scanState.conditionalDecisionStack.length - 1
      ];
    const source = parentMenu
      ? parentMenu.id
      : (decisionContext?.decisionNodeId ?? scanState.currentLabelId);
    if (source) {
      addEdge(state, {
        id: edgeIdWithOption(
          `seq_${source}__${newMenuId}`,
          parentMenu?.optionText,
        ),
        source,
        target: newMenuId,
        kind: "sequence",
        label: parentMenu?.optionText ?? undefined,
        condition: decisionContext
          ? {
            branchKind: decisionContext.branchKind,
            expression: decisionContext.expression ?? undefined,
            references: decisionContext.references,
            decisionNodeId: decisionContext.decisionNodeId,
          }
          : undefined,
      });
      addOutgoing(state, source, "sequence");
      addIncoming(state, newMenuId, "sequence");
    }

    scanState.menuStack.push({ id: newMenuId, optionText: null, options: [] });
    assertInvariant(
      scanState.menuStack.length <= menuDepth,
      `menu stack depth exceeded menu meta depth (${scanState.menuStack.length} > ${menuDepth})`,
    );

    if (scanState.conditionalIndentStack.length === 0) {
      scanState.labelHasExplicitExit = true;
    }
    return;
  }

  if (
    type === PARSER_TOKENS.entityFunctionName &&
    scanState.waitForMenuNameForId !== null &&
    meta.hasMenuStatement &&
    !meta.hasMenuBlock
  ) {
    const menuLabel = val();
    const existing = state.nodeMap.get(scanState.waitForMenuNameForId);
    if (existing) existing.label = menuLabel;
    scanState.waitForMenuNameForId = null;
    return;
  }

  if (
    type === PARSER_TOKENS.literalString &&
    meta.hasMenuOption &&
    meta.hasMenuBlock
  ) {
    const menu = menuAtDepth(scanState.menuStack, menuDepth);
    if (menu) {
      menu.optionText = val();
      if (!menu.options) {
        menu.options = [];
      }
      menu.options.push({ text: val(), hasExit: false });
    }
    return;
  }

  if (PARSER_TOKENS.kwScreen !== undefined && type === PARSER_TOKENS.kwScreen) {
    scanState.waitForCallTarget = false;
    scanState.waitForJumpTarget = false;
    return;
  }

  if (type === PARSER_TOKENS.kwJump && meta.hasJumpStatement) {
    scanState.currentLabelHasContentSinceSceneBoundary = true;
    scanState.waitForJumpTarget = true;
    scanState.waitForJumpExpressionTarget = false;
    return;
  }

  const isJumpTargetToken = type === PARSER_TOKENS.entityFunctionName ||
    (PARSER_TOKENS.entityIdentifier !== undefined &&
      type === PARSER_TOKENS.entityIdentifier) ||
    (PARSER_TOKENS.kwOther !== undefined &&
      type === PARSER_TOKENS.kwOther) ||
    (PARSER_TOKENS.metaItemAccess !== undefined &&
      type === PARSER_TOKENS.metaItemAccess) ||
    (PARSER_TOKENS.metaFunctionCall !== undefined &&
      type === PARSER_TOKENS.metaFunctionCall);

  if (
    isJumpTargetToken &&
    scanState.waitForJumpTarget &&
    meta.hasJumpStatement
  ) {
    const jumpMatch = /^\s*jump\s+(?:expression\s+)?(\.?[A-Za-z_][A-Za-z0-9_]*)\s*$/i.exec(
      lineText.split("#")[0],
    );
    const targetExpression = jumpMatch ? jumpMatch[1] : val().trim();
    const targets = resolveExpressionTargets(
      scanState,
      targetExpression,
      false,
      state,
    );
    const context = resolveCallContext(scanState, meta, menuDepth);
    if (targets.length === 0) {
      addDynamicTargetDiagnostic(
        state,
        chapter,
        "jump expression",
        targetExpression,
        context.source ?? undefined,
      );
      const isReliableJumpExit =
        scanState.conditionalIndentStack.length === 0 &&
        !meta.hasMenuOptionBlock;
      if (isReliableJumpExit) {
        scanState.labelHasExplicitExit = true;
      }
      scanState.waitForJumpTarget = false;
      scanState.waitForJumpExpressionTarget = false;
      return;
    }
    for (const target of targets) {
      emitJumpEdge(state, scanState, target, context, true);
    }
    scanState.waitForJumpTarget = false;
    scanState.waitForJumpExpressionTarget = false;
    return;
  }

  if (type === PARSER_TOKENS.kwCall && meta.hasCallStatement) {
    scanState.currentLabelHasContentSinceSceneBoundary = true;
    scanState.waitForCallTarget = true;
    return;
  }

  if (
    type === PARSER_TOKENS.entityFunctionName &&
    scanState.waitForCallTarget &&
    meta.hasCallStatement
  ) {
    const target = val();
    const context = resolveCallContext(scanState, meta, menuDepth);
    emitCallEdge(state, scanState, target, context);

    scanState.waitForCallTarget = false;
    return;
  }

  if (type === PARSER_TOKENS.kwReturn) {
    if (meta.hasMenuOptionBlock) {
      const menu = menuAtDepth(scanState.menuStack, scanState.menuStack.length);
      if (menu && menu.options) {
        const lastOpt = menu.options[menu.options.length - 1];
        if (lastOpt) {
          lastOpt.hasExit = true;
        }
      }
    } else {
      scanState.currentLabelHasContentSinceSceneBoundary = true;
      const isReliableReturn = scanState.conditionalIndentStack.length === 0;
      if (isReliableReturn && scanState.currentLabelId !== null) {
        scanState.labelHasExplicitExit = true;
        state.hasReliableReturnInLabel.add(scanState.currentLabelId);
      }
      if (scanState.currentLabelId !== null) {
        state.hasReturnInLabel.add(scanState.currentLabelId);
      }
    }
    return;
  }

  if (type === PARSER_TOKENS.literalString) {
    const isSay = meta.hasSayNarrator ||
      meta.hasSayCharacter ||
      meta.hasSayStatement;
    const isMenuOption = meta.hasMenuOption;

    if (isSay && !isMenuOption) {
      const trimmedLine = lineText.trim();
      const isCustomStatement = /^(gameover|title|timedchoice)\b/i.test(
        trimmedLine,
      );
      if (isCustomStatement) {
        return;
      }
      scanState.currentLabelHasContentSinceSceneBoundary = true;
      scanState.currentSceneDialogueCount =
        (scanState.currentSceneDialogueCount ?? 0) + 1;
      const menu = menuAtDepth(scanState.menuStack, menuDepth);
      const isInMenuPrompt = menu !== null && !meta.hasMenuOptionBlock;
      const ownerId = (meta.hasMenuOptionBlock && menu) || isInMenuPrompt
        ? menu.id
        : scanState.currentLabelId;

      if (ownerId) {
        const ownerNode = state.nodeMap.get(ownerId);
        if (ownerNode) {
          ownerNode.dialogueCount += 1;
          const line = val();
          // Always compute text stats regardless of captureDialogueLines
          const stats = computeTextStats(line);
          ownerNode.wordCount = (ownerNode.wordCount ?? 0) + stats.wordCount;
          ownerNode.pauseDuration = (ownerNode.pauseDuration ?? 0) +
            stats.pauseDuration;

          let speaker = "narrator";
          const charMatch = /^\s*([a-zA-Z_][a-zA-Z0-9_.]*)\b/.exec(lineText);
          if (charMatch) {
            speaker = charMatch[1]!;
          }
          if (!ownerNode.characterDialogue) {
            ownerNode.characterDialogue = {};
          }
          if (!ownerNode.characterDialogue[speaker]) {
            ownerNode.characterDialogue[speaker] = {
              lineCount: 0,
              wordCount: 0,
            };
          }
          const charStats = ownerNode.characterDialogue[speaker]!;
          charStats.lineCount += 1;
          charStats.wordCount += stats.wordCount;

          if (captureDialogueLines) {
            if (!ownerNode.dialogueLines) {
              ownerNode.dialogueLines = [];
              ownerNode.dialogueLineNums = [];
            }
            const lineNums = ownerNode.dialogueLineNums!;
            const insertIdx = lineNums.findIndex((num) => num > lineNum);
            if (insertIdx === -1) {
              ownerNode.dialogueLines.push(line);
              lineNums.push(lineNum);
            } else {
              ownerNode.dialogueLines.splice(insertIdx, 0, line);
              lineNums.splice(insertIdx, 0, lineNum);
            }
          }
          if (ownerNode.type === "MENU" && isInMenuPrompt) {
            const currentLineNum = ownerNode.menuPromptLineNum;
            const isUnnamed = ownerNode.label === ownerNode.id;
            const isSetByDialogue = currentLineNum !== undefined;
            if (isUnnamed || (isSetByDialogue && lineNum < currentLineNum)) {
              ownerNode.label = line;
              ownerNode.menuPromptLineNum = lineNum;
            }
          }
        }
      }
    }
  }
}

function edgeIdWithOption(baseId: string, optionText: string | null): string {
  if (!optionText) return baseId;
  return `${baseId}_${optionText}`;
}
