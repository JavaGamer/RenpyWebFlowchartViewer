import type {
  ParseGraphState,
  ParseScanState,
  TokenMetaFlags,
} from "../pipelineTypes.ts";
import { splitCurrentLabelOnSceneBoundary } from "../handlers/labelHandler.ts";
import {
  extractPlayCue,
  extractQueueCue,
  extractSceneAsset,
  extractStopCue,
  extractVoiceCue,
} from "../handlers/audioCues.ts";
import type { SourceLocation } from "../../domain/index.ts";

export function handleSceneToken(
  state: ParseGraphState,
  scanState: ParseScanState,
  chapter: string,
  meta: TokenMetaFlags,
  menuDepth: number,
  lineText: string,
  lineNum: number,
  deferDetails?: boolean,
  sceneSplitDialogueThreshold?: number,
  sourceLocation?: SourceLocation,
): void {
  splitCurrentLabelOnSceneBoundary(
    state,
    scanState,
    chapter,
    meta,
    menuDepth,
    sceneSplitDialogueThreshold,
  );
  if (scanState.currentLabelId && !deferDetails) {
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
          sourceLocation,
        });
      }
    }
  }
}

export function handlePlayToken(
  state: ParseGraphState,
  scanState: ParseScanState,
  lineText: string,
  lineNum: number,
  deferDetails?: boolean,
  sourceLocation?: SourceLocation,
): void {
  scanState.currentLabelHasContentSinceSceneBoundary = true;
  if (scanState.currentLabelId && !deferDetails) {
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
          sourceLocation,
        });
      }
    }
  }
}

export function handleStopToken(
  state: ParseGraphState,
  scanState: ParseScanState,
  lineText: string,
  lineNum: number,
  deferDetails?: boolean,
  sourceLocation?: SourceLocation,
): void {
  scanState.currentLabelHasContentSinceSceneBoundary = true;
  if (scanState.currentLabelId && !deferDetails) {
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
          sourceLocation,
        });
      }
    }
  }
}

export function handleQueueToken(
  state: ParseGraphState,
  scanState: ParseScanState,
  lineText: string,
  lineNum: number,
  deferDetails?: boolean,
  sourceLocation?: SourceLocation,
): void {
  scanState.currentLabelHasContentSinceSceneBoundary = true;
  if (scanState.currentLabelId && !deferDetails) {
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
          sourceLocation,
        });
      }
    }
  }
}

export function handleVoiceToken(
  state: ParseGraphState,
  scanState: ParseScanState,
  lineText: string,
  lineNum: number,
  deferDetails?: boolean,
  sourceLocation?: SourceLocation,
): void {
  scanState.currentLabelHasContentSinceSceneBoundary = true;
  if (scanState.currentLabelId && !deferDetails) {
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
          sourceLocation,
        });
      }
    }
  }
}
