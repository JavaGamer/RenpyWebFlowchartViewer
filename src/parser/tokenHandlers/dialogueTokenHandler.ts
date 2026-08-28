import { PAUSE_TAG_REGEX, TEXT_TAG_STRIP_REGEX } from "../utils/lineUtils.ts";
import type {
  ParseGraphState,
  ParseScanState,
  TokenMetaFlags,
} from "../pipelineTypes.ts";
import { menuAtDepth } from "../scanTransitions.ts";
import type { SourceLocation } from "../../domain/index.ts";

export function computeTextStats(
  text: string,
): { wordCount: number; pauseDuration: number } {
  let pauseDuration = 0;
  PAUSE_TAG_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = PAUSE_TAG_REGEX.exec(text)) !== null) {
    pauseDuration += parseFloat(match[1]!);
  }

  TEXT_TAG_STRIP_REGEX.lastIndex = 0;
  const stripped = text.replace(TEXT_TAG_STRIP_REGEX, "");
  const wordCount = stripped.trim() === ""
    ? 0
    : stripped.trim().split(/\s+/).length;

  return { wordCount, pauseDuration };
}

export function handleDialogueStringToken(
  state: ParseGraphState,
  scanState: ParseScanState,
  val: () => string,
  lineText: string,
  lineNum: number,
  meta: TokenMetaFlags,
  menuDepth: number,
  captureDialogueLines: boolean,
  deferDetails?: boolean,
  sourceLocation?: SourceLocation,
): void {
  const isSay = meta.hasSayNarrator ||
    meta.hasSayCharacter ||
    meta.hasSayStatement;
  const isMenuOption = meta.hasMenuOption;

  if (!isSay || isMenuOption) {
    return;
  }

  const trimmedLine = lineText.trim();
  const isCustomStatement = /^(gameover|title|timedchoice)\b/i.test(
    trimmedLine,
  );
  const isAudioOrSceneCue = /^(play|queue|sound|music|voice|scene|stop)\b/i
    .test(trimmedLine);
  if (isCustomStatement || isAudioOrSceneCue) {
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

  if (!ownerId) return;

  const ownerNode = state.nodeMap.get(ownerId);
  if (!ownerNode) return;

  ownerNode.dialogueCount += 1;
  const line = val();
  const stats = computeTextStats(line);
  ownerNode.wordCount = (ownerNode.wordCount ?? 0) + stats.wordCount;
  ownerNode.pauseDuration = (ownerNode.pauseDuration ?? 0) +
    stats.pauseDuration;

  let speaker = "narrator";
  const quotedSpeakerMatch = /^\s*["']([^"']+)["']\s+["']/.exec(lineText);
  if (quotedSpeakerMatch) {
    speaker = quotedSpeakerMatch[1]!;
  } else {
    const charMatch = /^\s*([a-zA-Z_][a-zA-Z0-9_.]*)\b/.exec(lineText);
    if (charMatch) {
      speaker = charMatch[1]!;
    }
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

  if (captureDialogueLines && !deferDetails) {
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
    ownerNode.isDetailsLoaded = true;
  }
  if (ownerNode.sourceLocation && sourceLocation) {
    ownerNode.sourceLocation.end = sourceLocation.end;
  }
  if (menu && sourceLocation) {
    if (menu.sourceLocation) {
      menu.sourceLocation.end = sourceLocation.end;
    }
    const menuNode = state.nodeMap.get(menu.id);
    if (menuNode?.sourceLocation) {
      menuNode.sourceLocation.end = sourceLocation.end;
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
