import { isMenuKeywordTokenType, PARSER_TOKENS } from "../parserTokens.ts";
import type {
  ParseGraphState,
  ParseScanState,
  TokenMetaFlags,
} from "../pipelineTypes.ts";
import type { SourceLocation } from "../../domain/index.ts";
import type { ScreenActionKind } from "../../config/parserRules.ts";
import { isWithinCurrentLabelScope } from "../handlers/labelHandler.ts";
import { handleConditionalHeader } from "../handlers/conditionHandler.ts";

import { handlePreTokenLineStatements } from "./tokenPreProcessor.ts";
import {
  handleKwLabelToken,
  handleLabelNameToken,
} from "./labelTokenHandler.ts";
import {
  handlePlayToken,
  handleQueueToken,
  handleSceneToken,
  handleShowToken,
  handleStopToken,
  handleVoiceToken,
} from "./audioSceneHandler.ts";
import {
  handleDollarSignToken,
  handlePythonBlockToken,
  handleScreenBlockToken,
} from "./blockStatementHandler.ts";
import {
  handleMenuNameToken,
  handleMenuOptionToken,
  handleMenuStatementToken,
} from "./menuTokenHandler.ts";
import {
  handleCallKeywordToken,
  handleCallTargetToken,
  handleExpressionKeywordToken,
  handleJumpKeywordToken,
  handleJumpTargetToken,
  handleReturnKeywordToken,
  handleScreenKeywordToken,
} from "./jumpCallTokenHandler.ts";
import { handleDialogueStringToken } from "./dialogueTokenHandler.ts";

export interface HandleTokenInput {
  type: number;
  meta: TokenMetaFlags;
  val: () => string;
  chapter: string;
  menuDepth: number;
  lineIndent: number;
  lineText: string;
  lineNum: number;
  captureDialogueLines: boolean;
  deferDetails?: boolean;
  screenActionRuleMap: Map<string, ScreenActionKind>;
  sceneSplitDialogueThreshold?: number;
  sourceLocation?: SourceLocation;
}

export type TokenHandler = (
  state: ParseGraphState,
  scanState: ParseScanState,
  input: HandleTokenInput,
) => boolean | void;

// Direct token type lookup table for standard token types
const directHandlerMap = new Map<number, TokenHandler>();

// Handler for Label token
directHandlerMap.set(PARSER_TOKENS.kwLabel, (_state, scanState, input) => {
  if (input.meta.hasLabelStatement) {
    handleKwLabelToken(scanState, input.sourceLocation);
    return true;
  }
  return false;
});

// Handler for Scene token
if (PARSER_TOKENS.kwScene !== undefined) {
  directHandlerMap.set(PARSER_TOKENS.kwScene, (state, scanState, input) => {
    handleSceneToken(
      state,
      scanState,
      input.chapter,
      input.meta,
      input.menuDepth,
      input.lineText,
      input.lineNum,
      input.deferDetails,
      input.sceneSplitDialogueThreshold,
      input.sourceLocation,
    );
    return true;
  });
}

// Handler for Show token
if (PARSER_TOKENS.kwShow !== undefined) {
  directHandlerMap.set(PARSER_TOKENS.kwShow, (state, scanState, input) => {
    handleShowToken(
      state,
      scanState,
      input.lineText,
      input.lineNum,
      input.deferDetails,
      input.sourceLocation,
    );
    return true;
  });
}

// Handler for Play token
if (PARSER_TOKENS.kwPlay !== undefined) {
  directHandlerMap.set(PARSER_TOKENS.kwPlay, (state, scanState, input) => {
    handlePlayToken(
      state,
      scanState,
      input.lineText,
      input.lineNum,
      input.deferDetails,
      input.sourceLocation,
    );
    return true;
  });
}

// Handler for Stop token
if (PARSER_TOKENS.kwStop !== undefined) {
  directHandlerMap.set(PARSER_TOKENS.kwStop, (state, scanState, input) => {
    handleStopToken(
      state,
      scanState,
      input.lineText,
      input.lineNum,
      input.deferDetails,
      input.sourceLocation,
    );
    return true;
  });
}

// Handler for Queue token
if (PARSER_TOKENS.kwQueue !== undefined) {
  directHandlerMap.set(PARSER_TOKENS.kwQueue, (state, scanState, input) => {
    handleQueueToken(
      state,
      scanState,
      input.lineText,
      input.lineNum,
      input.deferDetails,
      input.sourceLocation,
    );
    return true;
  });
}

// Handler for Voice token
if (PARSER_TOKENS.kwVoice !== undefined) {
  directHandlerMap.set(PARSER_TOKENS.kwVoice, (state, scanState, input) => {
    handleVoiceToken(
      state,
      scanState,
      input.lineText,
      input.lineNum,
      input.deferDetails,
      input.sourceLocation,
    );
    return true;
  });
}

// Handler for Conditional token (if/elif/else)
directHandlerMap.set(
  PARSER_TOKENS.kwConditional,
  (state, scanState, input) => {
    if (
      handleConditionalHeader(
        state,
        scanState,
        input.meta,
        input.menuDepth,
        input.chapter,
      )
    ) {
      scanState.currentLabelHasContentSinceSceneBoundary = true;
    }
    return false;
  },
);

// Handler for Dollar sign token ($)
if (PARSER_TOKENS.kwDollarSign !== undefined) {
  directHandlerMap.set(
    PARSER_TOKENS.kwDollarSign,
    (state, scanState, input) => {
      handleDollarSignToken(
        state,
        scanState,
        input.lineText,
        input.lineNum,
        input.chapter,
        input.meta,
        input.menuDepth,
      );
      return true;
    },
  );
}

// Handler for Python Block token
if (PARSER_TOKENS.metaPythonBlock !== undefined) {
  directHandlerMap.set(
    PARSER_TOKENS.metaPythonBlock,
    (state, scanState, input) => {
      handlePythonBlockToken(
        state,
        scanState,
        input.val,
        input.lineNum,
        input.chapter,
        input.meta,
        input.menuDepth,
      );
      return true;
    },
  );
}

// Handler for Screen Block token
if (PARSER_TOKENS.metaScreenBlock !== undefined) {
  directHandlerMap.set(
    PARSER_TOKENS.metaScreenBlock,
    (state, scanState, input) => {
      handleScreenBlockToken(
        state,
        scanState,
        input.val,
        input.chapter,
        input.meta,
        input.menuDepth,
        input.screenActionRuleMap,
      );
      return true;
    },
  );
}

// Handler for Screen keyword
if (PARSER_TOKENS.kwScreen !== undefined) {
  directHandlerMap.set(PARSER_TOKENS.kwScreen, (_state, scanState) => {
    handleScreenKeywordToken(scanState);
    return true;
  });
}

// Handler for Expression keyword
if (PARSER_TOKENS.kwExpression !== undefined) {
  directHandlerMap.set(PARSER_TOKENS.kwExpression, (_state, scanState) => {
    handleExpressionKeywordToken(scanState);
    return true;
  });
}

// Handler for Jump keyword
directHandlerMap.set(PARSER_TOKENS.kwJump, (_state, scanState) => {
  handleJumpKeywordToken(scanState);
  return true;
});

// Handler for Call keyword
directHandlerMap.set(PARSER_TOKENS.kwCall, (_state, scanState) => {
  handleCallKeywordToken(scanState);
  return true;
});

// Handler for Return keyword
directHandlerMap.set(PARSER_TOKENS.kwReturn, (state, scanState, input) => {
  handleReturnKeywordToken(state, scanState, input.meta);
  return true;
});

function dispatchMenuTokens(
  state: ParseGraphState,
  scanState: ParseScanState,
  input: HandleTokenInput,
): boolean {
  const { type, meta } = input;
  if (isMenuKeywordTokenType(type) && meta.hasMenuStatement) {
    handleMenuStatementToken(
      state,
      scanState,
      input.chapter,
      input.menuDepth,
      input.sourceLocation,
    );
    return true;
  }

  if (
    type === PARSER_TOKENS.entityFunctionName &&
    scanState.waitForMenuNameForId !== null &&
    meta.hasMenuStatement &&
    !meta.hasMenuBlock
  ) {
    handleMenuNameToken(state, scanState, input.val());
    return true;
  }

  if (
    type === PARSER_TOKENS.literalString &&
    meta.hasMenuOption &&
    meta.hasMenuBlock
  ) {
    handleMenuOptionToken(
      scanState,
      input.val(),
      input.menuDepth,
      input.lineText,
    );
    return true;
  }
  return false;
}

function dispatchJumpCallTargets(
  state: ParseGraphState,
  scanState: ParseScanState,
  input: HandleTokenInput,
): boolean {
  const { type, meta } = input;
  const isJumpTargetToken = type === PARSER_TOKENS.entityFunctionName ||
    (PARSER_TOKENS.entityIdentifier !== undefined &&
      type === PARSER_TOKENS.entityIdentifier) ||
    (PARSER_TOKENS.metaItemAccess !== undefined &&
      type === PARSER_TOKENS.metaItemAccess) ||
    (PARSER_TOKENS.metaFunctionCall !== undefined &&
      type === PARSER_TOKENS.metaFunctionCall) ||
    scanState.waitForJumpExpressionTarget;

  if (isJumpTargetToken && scanState.waitForJumpTarget) {
    handleJumpTargetToken(
      state,
      scanState,
      input.val,
      input.lineText,
      input.chapter,
      meta,
      input.menuDepth,
      input.sourceLocation,
    );
    return true;
  }

  const isCallTargetToken = type === PARSER_TOKENS.entityFunctionName ||
    (PARSER_TOKENS.entityIdentifier !== undefined &&
      type === PARSER_TOKENS.entityIdentifier) ||
    (PARSER_TOKENS.metaItemAccess !== undefined &&
      type === PARSER_TOKENS.metaItemAccess) ||
    (PARSER_TOKENS.metaFunctionCall !== undefined &&
      type === PARSER_TOKENS.metaFunctionCall) ||
    Boolean(scanState.waitForCallExpressionTarget);

  if (isCallTargetToken && scanState.waitForCallTarget) {
    handleCallTargetToken(
      state,
      scanState,
      input.val,
      input.lineText,
      input.chapter,
      meta,
      input.menuDepth,
      input.sourceLocation,
    );
    return true;
  }
  return false;
}

export function dispatchToken(
  state: ParseGraphState,
  scanState: ParseScanState,
  input: HandleTokenInput,
): void {
  // 1. Line pre-processing
  handlePreTokenLineStatements(
    state,
    scanState,
    input.lineText,
    input.lineNum,
    input.chapter,
    input.meta,
    input.menuDepth,
    input.sourceLocation,
  );

  const { type, meta } = input;

  // Handle pending match/case conditional header
  if (
    scanState.pendingConditionalHeader &&
    (scanState.pendingConditionalHeader.kind === "match" ||
      scanState.pendingConditionalHeader.kind === "case")
  ) {
    if (
      handleConditionalHeader(
        state,
        scanState,
        input.meta,
        input.menuDepth,
        input.chapter,
      )
    ) {
      scanState.currentLabelHasContentSinceSceneBoundary = true;
    }
  }

  // 2. Check label keyword
  if (type === PARSER_TOKENS.kwLabel && meta.hasLabelStatement) {
    handleKwLabelToken(scanState, input.sourceLocation);
    return;
  }

  // 3. Check label name token when waiting for label name
  if (
    type === PARSER_TOKENS.entityFunctionName &&
    scanState.waitForLabelName &&
    meta.hasLabelStatement
  ) {
    handleLabelNameToken(
      state,
      scanState,
      input.val().trim(),
      input.chapter,
      input.lineIndent,
      input.lineText,
      input.sourceLocation,
    );
    return;
  }

  // 4. Scope guard
  if (!isWithinCurrentLabelScope(scanState, meta, input.lineIndent)) {
    return;
  }

  // 5. Voice check if kwOther
  const isVoiceOtherToken = PARSER_TOKENS.kwOther !== undefined &&
    type === PARSER_TOKENS.kwOther &&
    input.val().trim().toLowerCase() === "voice";

  if (isVoiceOtherToken) {
    handleVoiceToken(
      state,
      scanState,
      input.lineText,
      input.lineNum,
      input.deferDetails,
      input.sourceLocation,
    );
    return;
  }

  // 6. Direct lookup map dispatch
  const handler = directHandlerMap.get(type);
  if (handler) {
    const handled = handler(state, scanState, input);
    if (handled) return;
  }

  // 7. Label scope active guard
  if (scanState.currentLabelId === null) return;

  // 8. Menu statements
  if (dispatchMenuTokens(state, scanState, input)) return;

  // 9. Jump / Call target token evaluation
  if (dispatchJumpCallTargets(state, scanState, input)) return;

  // 10. Dialogue string literals
  if (type === PARSER_TOKENS.literalString) {
    if (
      scanState.lastConditionalLine === input.lineNum ||
      /^\s*(?:if|elif|else|while|for|match|case)\b/.test(input.lineText ?? "")
    ) {
      return;
    }
    handleDialogueStringToken(
      state,
      scanState,
      input.val,
      input.lineText,
      input.lineNum,
      meta,
      input.menuDepth,
      input.captureDialogueLines,
      input.deferDetails,
      input.sourceLocation,
    );
  }
}
