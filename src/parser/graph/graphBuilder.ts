/**
 * src/parser/graph/graphBuilder.ts
 *
 * Story Graph Builder: Transforms RenpyScriptAst into clean FlowNode[] and FlowEdge[].
 * Adheres strictly to the domain model in src/domain/graph.ts.
 */

import type {
  AudioAssetCue,
  CallArgument,
  CallContext,
  ConditionMetadata,
  FlowEdge,
  FlowNode,
  LabelParameter,
  NodeDetailsPayload,
  SourceLocation,
  VariableMutation,
} from "../../domain/index.ts";
import type {
  AstSourceLocation,
  CallStatementAst,
  IfStatementAst,
  JumpStatementAst,
  LabelStatementAst,
  MatchStatementAst,
  MenuStatementAst,
  RenpyScriptAst,
  ScreenActionAst,
  ScreenStatementAst,
  StatementAst,
  VariableMutationAst,
  WhileStatementAst,
} from "../ast/types.ts";
import {
  evaluatePythonAstExpression,
  extractConditionFlagRefs,
} from "../../domain/index.ts";
import {
  extractLiteralTarget,
  parseDictLiteral,
  parseTimedChoice,
} from "../utils.ts";
import type {
  DynamicJumpRule,
  InitVariableDescriptor,
  ParseDiagnostic,
} from "../pipelineTypes.ts";
import {
  getParserVariantPlugins,
  type ParserVariant,
  type ParserVariantPlugin,
  type ScreenActionRule,
  type SerializableParserVariantPlugin,
} from "../plugins/index.ts";

export interface BuildGraphOptions {
  screens?: Map<string, ScreenStatementAst>;
  parserVariant?: ParserVariant;
  customVariantPlugins?: SerializableParserVariantPlugin[];
  screenActionRules?: ScreenActionRule[];
  captureDialogueLines?: boolean;
  deferDetails?: boolean;
  dynamicJumpRules?: DynamicJumpRule[];
  pruneDeadEndDecisions?: boolean;
}

export interface GraphBuildResult {
  chapter?: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
  diagnostics?: ParseDiagnostic[];
  initVariables?: Map<string, InitVariableDescriptor>;
  initDescriptors?: InitVariableDescriptor[];
  screens?: Map<string, ScreenStatementAst>;
  imageDefinitions?: Map<string, string>;
  nodeDetails?: Map<string, NodeDetailsPayload>;
  hasReliableReturnInLabel?: Set<string>;
  unresolvedDynamicJumps?: Array<{
    sourceNodeId: string;
    targetExpression: string;
    sourceLocation: AstSourceLocation;
  }>;
  pythonReferencedVariables?: Set<string>;
  conditionalExpressions?: Array<{
    branchKind: string;
    expression: string;
    sourceId?: string;
    sourceLocation?: SourceLocation;
    chapter?: string;
  }>;
}

const BUILTIN_TERMINAL_REGEX =
  /^(?:\$\s*)?(?:gameover\b|title\b|MainMenu\s*\(|renpy\.(?:full_restart|quit|utter_restart|jump_out_of_context|pop_call)\b)/i;

const BUILTIN_IGNORED_ACTIONS = new Set([
  "confirm",
  "if",
  "selectedif",
  "sensitiveif",
  "showif",
  "nullaction",
  "start",
  "play",
  "stop",
  "queue",
  "voice",
  "with",
  "notify",
  "help",
  "preference",
  "function",
  "setdict",
  "setfield",
  "rollback",
  "screenshot",
  "quit",
  "hide",
  "show",
  "showmenu",
  "showtransient",
  "togglescreen",
  "setvariable",
  "togglevariable",
  "setscreenvariable",
  "togglescreenvariable",
  "setlocalvariable",
  "togglelocalvariable",
  "mainmenu",
  "fileaction",
  "filesave",
  "fileload",
  "filedelete",
  "filepage",
  "filepagenext",
  "filepageprevious",
  "filetakescreenshot",
  "filepagetotals",
  "filepageempty",
  "quicksave",
  "quickload",
  "skip",
  "rollforward",
  "setmute",
  "togglemute",
  "pauseaudio",
  "hideinterface",
  "openurl",
  "mousemovescaling",
  "return",
]);

interface PostContinuationInfo {
  kind: "jump" | "call" | "return" | "node" | "next" | "none";
  target?: string;
  callStmt?: CallStatementAst;
}

function statementHasMenu(stmt: StatementAst): boolean {
  if (stmt.kind === "menu") return true;
  if (stmt.kind === "if") {
    return stmt.branches.some((b) => b.body.some(statementHasMenu));
  }
  return false;
}

function isOnlyStagingBeforeReturn(stmts: StatementAst[]): boolean {
  if (stmts.length === 0 || !stmts.some((s) => s.kind === "return")) {
    return false;
  }
  for (let i = 0; i < stmts.length; i++) {
    const s = stmts[i]!;
    if (s.kind === "return") {
      return stmts.slice(i + 1).every((rem) =>
        rem.kind === "return" || rem.kind === "pass"
      );
    }
    if (s.kind === "asset_cue" || s.kind === "pass") {
      continue;
    }
    if (s.kind === "generic") {
      const trimmed = s.rawText.trim();
      if (
        !/^\s*(?:with|window|pass|pause|camera|nvl|hide|show|scene)\b/i.test(
          trimmed,
        )
      ) {
        return false;
      }
    } else {
      return false;
    }
  }
  return true;
}

export class StoryGraphBuilder {
  private ast: RenpyScriptAst;
  private chapter: string;
  private screens: Map<string, ScreenStatementAst>;
  private options: BuildGraphOptions;
  private activePlugin: ParserVariantPlugin | undefined;
  private currentGlobalLabel: string = "";

  private nodes: FlowNode[] = [];
  private edges: FlowEdge[] = [];
  private diagnostics: ParseDiagnostic[] = [];
  private initVariables: Map<string, InitVariableDescriptor> = new Map();
  private variableState: Record<string, unknown> = {};
  private pendingTimedChoice: {
    duration: number;
    target: string;
    title?: string;
    sourceLocation: AstSourceLocation;
  } | null = null;
  private unresolvedDynamicJumps: Array<{
    sourceNodeId: string;
    targetExpression: string;
    sourceLocation: AstSourceLocation;
  }> = [];
  private imageDefinitions: Map<string, string> = new Map();
  private nodeDetails: Map<string, NodeDetailsPayload> = new Map();
  private hasReliableReturnInLabel: Set<string> = new Set();
  private nodeIds: Set<string> = new Set();
  private edgeIds: Set<string> = new Set();
  private currentReturnTarget: string | null = null;
  private menuCounter: number = 0;
  private menuIdMap: Map<MenuStatementAst, string> = new Map();
  private initDescriptors: InitVariableDescriptor[] = [];
  private localScope: Record<string, unknown> = {};
  private pythonReferencedVariables: Set<string> = new Set();
  private conditionalExpressions: Array<{
    branchKind: string;
    expression: string;
    sourceId?: string;
    sourceLocation?: SourceLocation;
    chapter?: string;
  }> = [];

  constructor(ast: RenpyScriptAst, options: BuildGraphOptions = {}) {
    this.ast = ast;
    this.options = options;
    this.chapter = ast.file.replace(/\\/g, "/").replace(/\.rpy$/i, "");
    this.screens = options.screens ?? new Map();

    const plugins = getParserVariantPlugins();
    this.activePlugin = plugins.find((p) => p.id === options.parserVariant);

    // Index any screens declared in this script
    for (const stmt of ast.statements) {
      if (stmt.kind === "screen") {
        this.screens.set(stmt.name, stmt);
      }
    }
  }

  public build(): GraphBuildResult {
    this.nodes = [];
    this.edges = [];
    this.diagnostics = [];
    this.initVariables.clear();
    this.initDescriptors = [];
    this.variableState = {};
    this.localScope = {};
    this.pendingTimedChoice = null;
    this.unresolvedDynamicJumps = [];
    this.pythonReferencedVariables.clear();
    this.conditionalExpressions = [];
    this.imageDefinitions.clear();
    this.nodeDetails.clear();
    this.hasReliableReturnInLabel.clear();
    this.nodeIds.clear();
    this.edgeIds.clear();
    this.menuCounter = 0;
    this.menuIdMap.clear();

    // Index top-level definitions, default/defines, screens, and init variables
    for (const stmt of this.ast.statements) {
      if (stmt.kind === "screen") {
        this.screens.set(stmt.name, stmt);
      } else if (stmt.kind === "image") {
        this.imageDefinitions.set(stmt.name, stmt.expression);
      } else if (stmt.kind === "define") {
        let val: InitVariableDescriptor["value"] = stmt
          .value as InitVariableDescriptor["value"];
        const strVal = String(stmt.rawExpression).trim();
        if (strVal.startsWith("[") && strVal.endsWith("]")) {
          val = strVal
            .slice(1, -1)
            .split(",")
            .map((s) => s.trim().replace(/^["']|["']$/g, ""))
            .filter(Boolean);
        } else if (strVal.startsWith("{") && strVal.endsWith("}")) {
          const dictMap = parseDictLiteral(strVal);
          if (dictMap) {
            val = dictMap;
          }
        }
        const desc: InitVariableDescriptor = {
          name: stmt.name,
          rawExpression: stmt.rawExpression,
          value: typeof val === "number" ? String(val) : val,
          kind: "define",
          priority: stmt.priority,
          filePath: this.ast.file,
          lineIndex: stmt.sourceLocation.start.line,
          isPersistent: stmt.name.startsWith("persistent."),
        };
        this.initDescriptors.push(desc);
        this.initVariables.set(stmt.name, desc);
        this.variableState[stmt.name] = val;
        this.localScope[stmt.name] = val;
      } else if (stmt.kind === "default") {
        let val: InitVariableDescriptor["value"] = stmt
          .value as InitVariableDescriptor["value"];
        const strVal = String(stmt.rawExpression).trim();
        if (strVal.startsWith("[") && strVal.endsWith("]")) {
          val = strVal
            .slice(1, -1)
            .split(",")
            .map((s) => s.trim().replace(/^["']|["']$/g, ""))
            .filter(Boolean);
        } else if (strVal.startsWith("{") && strVal.endsWith("}")) {
          const dictMap = parseDictLiteral(strVal);
          if (dictMap) {
            val = dictMap;
          }
        }
        const desc: InitVariableDescriptor = {
          name: stmt.name,
          rawExpression: stmt.rawExpression,
          value: typeof val === "number" ? String(val) : val,
          kind: "default",
          priority: stmt.priority,
          filePath: this.ast.file,
          lineIndex: stmt.sourceLocation.start.line,
          isPersistent: stmt.name.startsWith("persistent."),
        };
        this.initDescriptors.push(desc);
        this.initVariables.set(stmt.name, desc);
        if (this.variableState[stmt.name] === undefined) {
          this.variableState[stmt.name] = val;
          this.localScope[stmt.name] = val;
        }
      } else if (stmt.kind === "init") {
        for (const s of stmt.body) {
          if (s.kind === "python") {
            for (const m of s.mutations) {
              const val = typeof m.value === "string" ? m.value : m.value;
              const isPersist = m.variableName.startsWith("persistent.");
              const desc: InitVariableDescriptor = {
                name: m.variableName,
                rawExpression: m.rawExpression,
                value: val as InitVariableDescriptor["value"],
                kind: isPersist ? "persistent" : "python",
                priority: stmt.priority ?? 0,
                filePath: this.ast.file,
                lineIndex: s.sourceLocation.start.line,
                isPersistent: isPersist,
              };
              this.initDescriptors.push(desc);
              this.initVariables.set(m.variableName, desc);
              this.variableState[m.variableName] = val;
            }
          }
        }
      } else if (stmt.kind === "python_block") {
        const priority = stmt.isEarly ? -50000 : 0;
        const assignRegex =
          /([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*)\s*=\s*([^;\n]+)/g;
        let m: RegExpExecArray | null;
        while ((m = assignRegex.exec(stmt.code)) !== null) {
          const varName = m[1]!;
          const rawVal = m[2]!.trim().replace(/^["']|["']$/g, "");
          const desc: InitVariableDescriptor = {
            name: varName,
            rawExpression: m[2]!.trim(),
            value: rawVal as InitVariableDescriptor["value"],
            kind: stmt.isEarly
              ? "python"
              : (varName.startsWith("persistent.") ? "persistent" : "python"),
            priority,
            filePath: this.ast.file,
            lineIndex: stmt.sourceLocation.start.line,
            isPersistent: varName.startsWith("persistent."),
          };
          this.initDescriptors.push(desc);
          this.initVariables.set(varName, desc);
          this.variableState[varName] = rawVal;
        }
      }
    }

    const labelStatements: LabelStatementAst[] = [];
    let currentLabel: LabelStatementAst | null = null;
    for (const stmt of this.ast.statements) {
      if (stmt.kind === "label") {
        currentLabel = stmt;
        labelStatements.push(stmt);
      } else if (stmt.kind === "menu" && currentLabel) {
        currentLabel.body.push(stmt);
      }
    }

    // Track which nodes terminate unconditionally to handle fallthrough
    const labelTerminalExits = new Map<string, boolean>();

    for (let i = 0; i < labelStatements.length; i++) {
      const labelStmt = labelStatements[i]!;
      const nextLabelStmt = i + 1 < labelStatements.length
        ? labelStatements[i + 1]!
        : null;
      const nextId = nextLabelStmt ? nextLabelStmt.canonicalName : null;

      const { finalNodeId, hasExit } = this.processLabel(labelStmt, nextId);
      labelTerminalExits.set(finalNodeId, hasExit);

      // Check for implicit fallthrough to the subsequent label in the same file
      if (!hasExit && nextId) {
        this.addEdge({
          id: `seq_${finalNodeId}__${nextId}`,
          source: finalNodeId,
          target: nextId,
          kind: "sequence",
          isFallthrough: true,
          label: "next",
        });
      } else if (!hasExit && !nextId) {
        // Last label in file with no exit is a terminal outcome
        const finalNode = this.nodes.find((n) => n.id === finalNodeId);
        if (finalNode) {
          finalNode.isTerminalOutcome = true;
        }
      }
    }

    return {
      chapter: this.chapter,
      nodes: this.nodes,
      edges: this.edges,
      diagnostics: this.diagnostics,
      initVariables: this.initVariables,
      initDescriptors: this.initDescriptors,
      screens: this.screens,
      imageDefinitions: this.imageDefinitions,
      nodeDetails: this.nodeDetails,
      hasReliableReturnInLabel: this.hasReliableReturnInLabel,
      unresolvedDynamicJumps: this.unresolvedDynamicJumps,
      pythonReferencedVariables: this.pythonReferencedVariables,
      conditionalExpressions: this.conditionalExpressions,
    };
  }

  private processLabel(
    labelStmt: LabelStatementAst,
    nextId: string | null,
  ): {
    finalNodeId: string;
    hasExit: boolean;
  } {
    this.localScope = {};
    const labelId = labelStmt.canonicalName;
    if (!labelStmt.isLocal) {
      this.currentGlobalLabel = labelStmt.name;
    }

    // Aggregate primary dialogue and metrics for the main LabelNode
    const choiceIndices: number[] = [];
    for (let i = 0; i < labelStmt.body.length; i++) {
      if (statementHasMenu(labelStmt.body[i]!)) {
        choiceIndices.push(i);
      }
    }

    const preChoiceStmts = choiceIndices.length > 0
      ? labelStmt.body.slice(0, choiceIndices[0])
      : labelStmt.body;

    const primaryMetrics = this.analyzeStatements(preChoiceStmts, labelId);
    const captureDialogue = this.options.captureDialogueLines !== false;
    const isDeferred = Boolean(this.options.deferDetails);

    const labelNode: FlowNode = {
      id: labelId,
      type: "LABEL",
      role: primaryMetrics.dialogueLines.length > 0 ? "story" : "utility",
      label: labelStmt.name,
      isTerminalOutcome: false,
      dialogueCount: primaryMetrics.dialogueCount,
      wordCount: primaryMetrics.wordCount,
      ...(isDeferred ? { isDetailsLoaded: false } : {
        ...(captureDialogue && primaryMetrics.dialogueLines.length > 0
          ? {
            dialogueLines: primaryMetrics.dialogueLines,
            dialogueLineNums: primaryMetrics.dialogueLineNums,
          }
          : {}),
        audioAssetCues: primaryMetrics.audioAssetCues,
        isDetailsLoaded: true,
      }),
      characterDialogue: primaryMetrics.characterDialogue,
      mutations: primaryMetrics.mutations,
      chapter: this.chapter,
      sourceLocation: this.toDomainSourceLocation(labelStmt.sourceLocation),
      ...(labelStmt.parameters
        ? { parameters: labelStmt.parameters as LabelParameter[] }
        : {}),
    };
    this.addNode(labelNode);

    if (
      primaryMetrics.dialogueLines.length > 0 ||
      primaryMetrics.audioAssetCues.length > 0
    ) {
      this.nodeDetails.set(labelId, {
        nodeId: labelId,
        dialogueLines: primaryMetrics.dialogueLines,
        dialogueLineNums: primaryMetrics.dialogueLineNums,
        audioAssetCues: primaryMetrics.audioAssetCues,
      });
    }

    const hasTopLevelReturn = labelStmt.body.some((s) => s.kind === "return");
    const hasBranchExits = labelStmt.body.some((s) => {
      if (s.kind === "if") {
        const hasElse = s.branches.some((b) => b.branchKind === "else");
        const allReturn = s.branches.every((b) =>
          b.body.some((inner) => inner.kind === "return")
        );
        return hasElse && allReturn;
      }
      return false;
    });

    if (hasTopLevelReturn || hasBranchExits) {
      this.hasReliableReturnInLabel.add(labelId);
    }

    this.currentReturnTarget = labelId;

    let currentNodeId = labelId;
    let hasTerminalExit = false;

    // Process pre-choice statements for jumps/calls
    let branchExited = false;
    for (let i = 0; i < preChoiceStmts.length; i++) {
      const stmt = preChoiceStmts[i]!;
      if (branchExited && stmt.kind !== "screen") continue;
      const postStmts = preChoiceStmts.slice(i + 1);
      let postCont: PostContinuationInfo | undefined;
      if (postStmts.length === 0) {
        if (choiceIndices.length > 0) {
          const firstChoice = labelStmt.body[choiceIndices[0]!]!;
          const mId = firstChoice.kind === "menu"
            ? this.getMenuId(firstChoice)
            : `decision_${labelId}_L${firstChoice.sourceLocation.start.line}`;
          postCont = { kind: "node", target: mId };
        } else if (nextId) {
          postCont = { kind: "next", target: nextId };
        }
      } else {
        const first = postStmts[0]!;
        if (first.kind === "jump") {
          postCont = { kind: "jump", target: first.target };
        } else if (first.kind === "call") {
          postCont = { kind: "call", target: first.target, callStmt: first };
        } else if (first.kind === "return") {
          postCont = { kind: "return" };
        } else {
          postCont = { kind: "node", target: labelId };
        }
      }
      const exitInfo = this.processStatement(stmt, currentNodeId, postCont);
      if (exitInfo.hasExit) {
        hasTerminalExit = true;
        if (stmt.kind === "if") branchExited = true;
      }
    }

    // Process choice statements in sequence
    for (let m = 0; m < choiceIndices.length; m++) {
      const choiceStmt = labelStmt.body[choiceIndices[m]!]!;
      const nextIdx = m + 1 < choiceIndices.length
        ? choiceIndices[m + 1]!
        : labelStmt.body.length;
      const postStmts = labelStmt.body.slice(choiceIndices[m]! + 1, nextIdx);

      let continuationTargetId: string | null = null;
      let continuationTargets: string[] | undefined;
      let continuationKind: "sequence" | "jump" | "call" = "sequence";
      let continuationCallStmt: CallStatementAst | undefined;
      let hasSingleTerminalContinuation = false;

      if (postStmts.length > 0) {
        if (isOnlyStagingBeforeReturn(postStmts)) {
          hasSingleTerminalContinuation = true;
          continuationTargetId = null;
        } else {
          const singleJump =
            postStmts.length === 1 && postStmts[0]!.kind === "jump"
              ? (postStmts[0] as JumpStatementAst)
              : (postStmts.length === 1 && postStmts[0]!.kind === "python" &&
                  postStmts[0]!.embeddedJumps.length > 0
                ? postStmts[0]!.embeddedJumps[0]!
                : null);

          if (singleJump) {
            if (singleJump.isExpression) {
              const evalRes = evaluatePythonAstExpression(
                singleJump.target.trim(),
                { ...this.variableState, ...this.localScope },
              );
              if (
                evalRes.stringCandidates && evalRes.stringCandidates.length > 0
              ) {
                continuationTargets = evalRes.stringCandidates.map((c) =>
                  c.replace(/^["']|["']$/g, "").trim()
                );
              } else if (
                evalRes.isStaticallyEvaluated &&
                typeof evalRes.value === "string"
              ) {
                continuationTargetId = evalRes.value.replace(/^["']|["']$/g, "")
                  .trim();
              } else {
                continuationTargetId = singleJump.target;
              }
            } else {
              continuationTargetId = singleJump.target;
            }
            continuationKind = "jump";
            hasSingleTerminalContinuation = true;
          } else if (postStmts[0]!.kind === "call") {
            const firstCall = postStmts[0] as CallStatementAst;
            continuationTargetId = firstCall.target;
            continuationKind = "call";
            continuationCallStmt = firstCall;
            if (postStmts.length === 1) {
              hasSingleTerminalContinuation = true;
            }
          } else {
            const firstPostStmt = postStmts[0]!;
            const isMenu = choiceStmt.kind === "menu";
            const hasPreDialogue = primaryMetrics.dialogueLines.length > 0;
            const shouldSplit = isMenu || hasPreDialogue;
            const contNodeId = shouldSplit
              ? `${labelId}__cont_L${firstPostStmt.sourceLocation.start.line}`
              : labelId;
            continuationTargetId = contNodeId;
            continuationKind = "sequence";
            const postMetrics = this.analyzeStatements(postStmts, labelId);

            if (shouldSplit) {
              const contNode: FlowNode = {
                id: contNodeId,
                type: "LABEL",
                role: "story",
                label: `${labelStmt.name} (cont)`,
                dialogueCount: postMetrics.dialogueCount,
                wordCount: postMetrics.wordCount,
                ...(isDeferred ? { isDetailsLoaded: false } : {
                  ...(captureDialogue && postMetrics.dialogueLines.length > 0
                    ? {
                      dialogueLines: postMetrics.dialogueLines,
                      dialogueLineNums: postMetrics.dialogueLineNums,
                    }
                    : {}),
                  audioAssetCues: postMetrics.audioAssetCues,
                  isDetailsLoaded: true,
                }),
                characterDialogue: postMetrics.characterDialogue,
                mutations: postMetrics.mutations,
                chapter: this.chapter,
                sourceLocation: this.toDomainSourceLocation(
                  firstPostStmt.sourceLocation,
                ),
              };
              this.addNode(contNode);

              if (
                postMetrics.dialogueLines.length > 0 ||
                postMetrics.audioAssetCues.length > 0
              ) {
                this.nodeDetails.set(contNodeId, {
                  nodeId: contNodeId,
                  dialogueLines: postMetrics.dialogueLines,
                  dialogueLineNums: postMetrics.dialogueLineNums,
                  audioAssetCues: postMetrics.audioAssetCues,
                });
              }
            } else {
              labelNode.dialogueCount = (labelNode.dialogueCount ?? 0) +
                postMetrics.dialogueCount;
              labelNode.wordCount = (labelNode.wordCount ?? 0) +
                postMetrics.wordCount;
              if (postMetrics.dialogueLines.length > 0) {
                labelNode.dialogueLines = [
                  ...(labelNode.dialogueLines || []),
                  ...postMetrics.dialogueLines,
                ];
                labelNode.dialogueLineNums = [
                  ...(labelNode.dialogueLineNums || []),
                  ...postMetrics.dialogueLineNums,
                ];
              }
              if (postMetrics.audioAssetCues.length > 0) {
                labelNode.audioAssetCues = [
                  ...(labelNode.audioAssetCues || []),
                  ...postMetrics.audioAssetCues,
                ];
              }
            }

            if (postStmts.some((s) => s.kind === "return")) {
              this.hasReliableReturnInLabel.add(contNodeId);
              this.hasReliableReturnInLabel.add(labelId);
            }
          }
        }
      } else if (m + 1 < choiceIndices.length) {
        const nextChoice = labelStmt.body[choiceIndices[m + 1]!]!;
        if (nextChoice.kind === "menu") {
          continuationTargetId = this.getMenuId(nextChoice);
        } else {
          continuationTargetId =
            `decision_${labelId}_L${nextChoice.sourceLocation.start.line}`;
        }
        continuationKind = "sequence";
      } else {
        continuationTargetId = this.hasReliableReturnInLabel.has(labelId)
          ? null
          : nextId;
        continuationKind = "sequence";
      }

      const effectiveNextId = (postStmts.some((s) => s.kind === "return") ||
          isOnlyStagingBeforeReturn(postStmts) ||
          this.hasReliableReturnInLabel.has(labelId))
        ? null
        : nextId;

      let allChoicesExit = false;
      if (choiceStmt.kind === "menu") {
        allChoicesExit = this.processMenu(
          choiceStmt,
          currentNodeId,
          labelId,
          continuationTargetId,
          effectiveNextId,
          undefined,
          undefined,
          continuationKind,
          continuationCallStmt,
          continuationTargets,
        );
      } else if (choiceStmt.kind === "if") {
        const postContInfo: PostContinuationInfo | undefined =
          continuationTargetId
            ? (continuationKind === "jump"
              ? { kind: "jump", target: continuationTargetId }
              : continuationKind === "call"
              ? {
                kind: "call",
                target: continuationTargetId,
                callStmt: continuationCallStmt,
              }
              : { kind: "node", target: continuationTargetId })
            : undefined;
        allChoicesExit = this.processIfStatement(
          choiceStmt,
          currentNodeId,
          undefined,
          postContInfo,
        ).hasExit;
      }

      if (
        postStmts.length > 0 && continuationTargetId &&
        !hasSingleTerminalContinuation
      ) {
        currentNodeId = continuationKind === "call"
          ? labelId
          : continuationTargetId;
        hasTerminalExit = false;
        for (const stmt of postStmts) {
          const exitInfo = this.processStatement(stmt, currentNodeId);
          if (exitInfo.hasExit) hasTerminalExit = true;
        }
      } else if (hasSingleTerminalContinuation) {
        hasTerminalExit = allChoicesExit;
      } else if (continuationTargetId && continuationTargetId !== nextId) {
        currentNodeId = continuationTargetId;
        hasTerminalExit = false;
      } else {
        hasTerminalExit = allChoicesExit;
      }
    }

    if (this.pendingTimedChoice) {
      let target = this.pendingTimedChoice.target;
      if (target.startsWith(".") && this.currentGlobalLabel) {
        target = `${this.currentGlobalLabel}${target}`;
      }
      this.addEdge({
        id:
          `tc_${currentNodeId}__${target}_L${this.pendingTimedChoice.sourceLocation.start.line}`,
        source: currentNodeId,
        target,
        kind: "jump",
        timeout: {
          isTimeout: true,
          durationSeconds: this.pendingTimedChoice.duration,
        },
        sourceLocation: this.toDomainSourceLocation(
          this.pendingTimedChoice.sourceLocation,
        ),
      });
      this.pendingTimedChoice = null;
    }

    return {
      finalNodeId: currentNodeId,
      hasExit: hasTerminalExit || this.hasReliableReturnInLabel.has(labelId),
    };
  }

  private getMenuId(menuStmt: MenuStatementAst): string {
    let id = this.menuIdMap.get(menuStmt);
    if (!id) {
      id = menuStmt.name
        ? `menu_${menuStmt.name}`
        : `menu_${++this.menuCounter}`;
      this.menuIdMap.set(menuStmt, id);
    }
    return id;
  }

  private processMenu(
    menuStmt: MenuStatementAst,
    sourceNodeId: string,
    labelId: string,
    continuationNodeId: string | null,
    nextId: string | null,
    inflowLabel?: string,
    inflowCondition?: ConditionMetadata,
    continuationKind: "sequence" | "jump" | "call" = "sequence",
    continuationCallStmt?: CallStatementAst,
    continuationTargets?: string[],
  ): boolean {
    const menuNodeId = this.getMenuId(menuStmt);

    const allPrompts = menuStmt.prompts && menuStmt.prompts.length > 0
      ? [...menuStmt.prompts]
      : (menuStmt.prompt ? [menuStmt.prompt] : []);

    for (const item of menuStmt.items) {
      for (const s of item.body) {
        if (s.kind === "say") {
          allPrompts.push(s.text);
        }
      }
    }

    const captureDialogue = this.options.captureDialogueLines !== false;

    const menuNode: FlowNode = {
      id: menuNodeId,
      type: "MENU",
      role: "menu",
      label: menuStmt.name || menuStmt.prompt || "Choice",
      dialogueCount: allPrompts.length,
      ...(captureDialogue && allPrompts.length > 0
        ? { dialogueLines: allPrompts }
        : {}),
      parentLabelId: labelId,
      chapter: this.chapter,
      sourceLocation: this.toDomainSourceLocation(menuStmt.sourceLocation),
    };
    this.addNode(menuNode);

    // Inflow edge to menu
    this.addEdge({
      id: `seq_${sourceNodeId}__${menuNodeId}`,
      source: sourceNodeId,
      target: menuNodeId,
      kind: "sequence",
      ...(inflowLabel ? { label: inflowLabel } : {}),
      ...(inflowCondition ? { condition: inflowCondition } : {}),
    });

    if (this.pendingTimedChoice) {
      let target = this.pendingTimedChoice.target;
      if (target.startsWith(".") && this.currentGlobalLabel) {
        target = `${this.currentGlobalLabel}${target}`;
      }
      this.addEdge({
        id:
          `tc_${menuNodeId}__${target}_L${this.pendingTimedChoice.sourceLocation.start.line}`,
        source: menuNodeId,
        target,
        kind: "jump",
        label: this.pendingTimedChoice.title ||
          `Timeout (${this.pendingTimedChoice.duration}s)`,
        timeout: {
          isTimeout: true,
          durationSeconds: this.pendingTimedChoice.duration,
        },
        sourceLocation: this.toDomainSourceLocation(
          this.pendingTimedChoice.sourceLocation,
        ),
      });
      this.pendingTimedChoice = null;
    }

    let allChoicesExit = menuStmt.items.length > 0;

    for (let cIdx = 0; cIdx < menuStmt.items.length; cIdx++) {
      const item = menuStmt.items[cIdx]!;
      const nestedMenu = item.body.find(
        (s): s is MenuStatementAst => s.kind === "menu",
      );
      const jumpStmt = this.findTerminalJump(item.body);
      const callStmt = this.findTerminalCall(item.body);
      const ifStmt = item.body.find(
        (s): s is IfStatementAst => s.kind === "if",
      );

      let conditionMeta: ConditionMetadata | undefined;
      if (item.condition) {
        conditionMeta = {
          branchKind: "if",
          expression: item.condition,
          decisionNodeId: menuNodeId,
        };
      }

      if (nestedMenu) {
        const nestedExit = this.processMenu(
          nestedMenu,
          menuNodeId,
          labelId,
          continuationNodeId,
          nextId,
          item.text,
          conditionMeta,
        );
        if (!nestedExit) allChoicesExit = false;
      } else if (jumpStmt) {
        this.addEdge({
          id: `jump_${menuNodeId}__${jumpStmt.target}_c${cIdx}`,
          source: menuNodeId,
          target: jumpStmt.target,
          kind: "jump",
          label: item.text,
          ...(conditionMeta ? { condition: conditionMeta } : {}),
          sourceLocation: this.toDomainSourceLocation(item.sourceLocation),
        });
      } else if (callStmt) {
        const retTarget = (continuationNodeId && continuationNodeId !== nextId)
          ? continuationNodeId
          : menuNodeId;
        const callContext: CallContext = {
          callContextId: `call_${menuNodeId}__${callStmt.target}_c${cIdx}`,
          callEdgeId: `call_${menuNodeId}__${callStmt.target}_c${cIdx}`,
          callSiteId: menuNodeId,
          returnTargetId: retTarget,
          arguments: callStmt.arguments as CallArgument[] | undefined,
        };

        this.addEdge({
          id: callContext.callEdgeId,
          source: menuNodeId,
          target: callStmt.target,
          kind: "call",
          label: item.text ? `call: ${item.text}` : "call",
          callContext,
          arguments: callStmt.arguments as CallArgument[] | undefined,
          ...(conditionMeta ? { condition: conditionMeta } : {}),
          sourceLocation: this.toDomainSourceLocation(item.sourceLocation),
        });
      } else if (ifStmt) {
        let allIfBranchesExit = true;
        const hasExplicitElse = ifStmt.branches.some((b) =>
          b.branchKind === "else"
        );
        if (!hasExplicitElse) allIfBranchesExit = false;

        for (const branch of ifStmt.branches) {
          const branchJump = this.findTerminalJump(branch.body);
          if (branchJump) {
            this.addEdge({
              id:
                `cjump_${menuNodeId}__${branchJump.target}_c${cIdx}_L${branch.sourceLocation.start.line}`,
              source: menuNodeId,
              target: branchJump.target,
              kind: "jump",
              label: item.text,
              condition: {
                branchKind: branch.branchKind,
                expression: branch.condition,
                references: extractConditionFlagRefs(branch.condition),
                decisionNodeId: menuNodeId,
              },
              sourceLocation: this.toDomainSourceLocation(
                branch.sourceLocation,
              ),
            });
          } else {
            allIfBranchesExit = false;
          }
        }

        if (!allIfBranchesExit) {
          allChoicesExit = false;
          const fallthroughTarget = continuationNodeId || nextId;
          if (fallthroughTarget) {
            this.addEdge({
              id: `choice_${menuNodeId}__${fallthroughTarget}_c${cIdx}`,
              source: menuNodeId,
              target: fallthroughTarget,
              kind: "sequence",
              label: item.text,
              ...(conditionMeta ? { condition: conditionMeta } : {}),
              sourceLocation: this.toDomainSourceLocation(item.sourceLocation),
            });
          }
        }
      } else if (
        item.body.some((s) => s.kind === "return") ||
        item.body.some(
          (s) =>
            (s.kind === "generic" && BUILTIN_TERMINAL_REGEX.test(s.rawText)) ||
            (s.kind === "python" && BUILTIN_TERMINAL_REGEX.test(s.code)),
        )
      ) {
        // Exits via return, gameover(), full_restart(), etc.
      } else if (continuationTargets && continuationTargets.length > 0) {
        for (const tgt of continuationTargets) {
          this.addEdge({
            id: `jump_${menuNodeId}__${tgt}_c${cIdx}`,
            source: menuNodeId,
            target: tgt,
            kind: "jump",
            label: item.text,
            ...(conditionMeta ? { condition: conditionMeta } : {}),
            sourceLocation: this.toDomainSourceLocation(item.sourceLocation),
          });
        }
      } else if (continuationNodeId) {
        if (continuationKind === "jump") {
          this.addEdge({
            id: `jump_${menuNodeId}__${continuationNodeId}_c${cIdx}`,
            source: menuNodeId,
            target: continuationNodeId,
            kind: "jump",
            label: item.text,
            ...(conditionMeta ? { condition: conditionMeta } : {}),
            sourceLocation: this.toDomainSourceLocation(item.sourceLocation),
          });
        } else if (continuationKind === "call") {
          const callContext: CallContext = {
            callContextId: `call_${menuNodeId}__${continuationNodeId}_c${cIdx}`,
            callEdgeId: `call_${menuNodeId}__${continuationNodeId}_c${cIdx}`,
            callSiteId: menuNodeId,
            returnTargetId: this.currentReturnTarget || menuNodeId,
            arguments: continuationCallStmt?.arguments as
              | CallArgument[]
              | undefined,
          };
          this.addEdge({
            id: callContext.callEdgeId,
            source: menuNodeId,
            target: continuationNodeId,
            kind: "call",
            label: item.text ? `call: ${item.text}` : "call",
            callContext,
            arguments: continuationCallStmt?.arguments as
              | CallArgument[]
              | undefined,
            ...(conditionMeta ? { condition: conditionMeta } : {}),
            sourceLocation: this.toDomainSourceLocation(item.sourceLocation),
          });
        } else {
          this.addEdge({
            id: `choice_${menuNodeId}__${continuationNodeId}_c${cIdx}`,
            source: menuNodeId,
            target: continuationNodeId,
            kind: "sequence",
            label: item.text,
            ...(conditionMeta ? { condition: conditionMeta } : {}),
            sourceLocation: this.toDomainSourceLocation(item.sourceLocation),
          });
        }
      } else if (nextId) {
        this.addEdge({
          id: `choice_${menuNodeId}__${nextId}_c${cIdx}`,
          source: menuNodeId,
          target: nextId,
          kind: "sequence",
          label: item.text,
          ...(conditionMeta ? { condition: conditionMeta } : {}),
          sourceLocation: this.toDomainSourceLocation(item.sourceLocation),
        });
      } else {
        allChoicesExit = false;
      }
    }

    return allChoicesExit;
  }

  private applyMutations(mutations: VariableMutationAst[]): void {
    for (const m of mutations) {
      const varName = m.variableName;
      const isGlobal = this.initVariables.has(varName);
      const current = this.localScope[varName] !== undefined
        ? this.localScope[varName]
        : this.variableState[varName];
      const rawVal = m.value;
      const operand = typeof rawVal === "number"
        ? rawVal
        : (!isNaN(Number(rawVal))
          ? Number(rawVal)
          : (typeof this.localScope[String(rawVal)] === "number"
            ? (this.localScope[String(rawVal)] as number)
            : (typeof this.variableState[String(rawVal)] === "number"
              ? (this.variableState[String(rawVal)] as number)
              : 0)));

      if (m.operator === "=") {
        const strVal = String(rawVal).trim();
        if (strVal.startsWith("{") && strVal.endsWith("}")) {
          const dictMap = parseDictLiteral(strVal);
          if (dictMap) {
            const dictObj: Record<string, string> = {};
            for (const [k, v] of dictMap.entries()) {
              dictObj[k] = v;
            }
            this.localScope[varName] = dictObj;
            if (isGlobal) this.variableState[varName] = dictObj;
            continue;
          }
        }

        if (strVal.startsWith("[") && strVal.endsWith("]")) {
          const listItems = strVal
            .slice(1, -1)
            .split(",")
            .map((s) => s.trim().replace(/^["']|["']$/g, ""))
            .filter(Boolean);
          this.localScope[varName] = listItems;
          if (isGlobal) this.variableState[varName] = listItems;
          continue;
        }

        const evalRes = evaluatePythonAstExpression(strVal, {
          ...this.variableState,
          ...this.localScope,
        });
        if (evalRes.isStaticallyEvaluated && evalRes.value !== undefined) {
          this.localScope[varName] = evalRes.value;
          if (isGlobal) this.variableState[varName] = evalRes.value;
          continue;
        }

        if (m.isLiteral && typeof rawVal === "string") {
          this.localScope[varName] = rawVal;
          if (isGlobal) this.variableState[varName] = rawVal;
        } else {
          const lit = extractLiteralTarget(strVal);
          if (lit !== null) {
            this.localScope[varName] = lit;
            if (isGlobal) this.variableState[varName] = lit;
          } else if (
            typeof rawVal === "number" ||
            (!isNaN(Number(rawVal)) && strVal !== "")
          ) {
            const num = Number(rawVal);
            this.localScope[varName] = num;
            if (isGlobal) this.variableState[varName] = num;
          } else {
            // Dynamic reassignment: invalidate local scope
            this.localScope[varName] = null;
          }
        }
      } else if (m.operator === "+=") {
        const prev = typeof current === "number"
          ? current
          : Number(current) || 0;
        const res = prev + operand;
        this.localScope[varName] = res;
        if (isGlobal) this.variableState[varName] = res;
      } else if (m.operator === "-=") {
        const prev = typeof current === "number"
          ? current
          : Number(current) || 0;
        const res = prev - operand;
        this.localScope[varName] = res;
        if (isGlobal) this.variableState[varName] = res;
      } else if (m.operator === "*=") {
        const prev = typeof current === "number"
          ? current
          : Number(current) || 0;
        const res = prev * operand;
        this.localScope[varName] = res;
        if (isGlobal) this.variableState[varName] = res;
      } else if (m.operator === "/=") {
        const prev = typeof current === "number"
          ? current
          : Number(current) || 0;
        if (operand !== 0) {
          const res = prev / operand;
          this.localScope[varName] = res;
          if (isGlobal) this.variableState[varName] = res;
        }
      } else if (m.operator === "toggle") {
        this.localScope[varName] = !current;
        if (isGlobal) this.variableState[varName] = !current;
      }
    }
  }

  private processStatement(
    stmt: StatementAst,
    sourceNodeId: string,
    postCont?: PostContinuationInfo,
  ): { hasExit: boolean } {
    switch (stmt.kind) {
      case "jump": {
        if (stmt.isExpression) {
          let matchedRule = false;
          if (this.options.dynamicJumpRules) {
            for (const rule of this.options.dynamicJumpRules) {
              const ruleRegex = new RegExp(rule.expressionPattern);
              if (ruleRegex.test(stmt.target.trim())) {
                matchedRule = true;
                const ruleTargets = Array.isArray(rule.targets)
                  ? rule.targets
                  : (typeof rule.targets === "function"
                    ? (rule.targets as (
                      expr: string,
                      scope: unknown,
                    ) => string[])(stmt.target.trim(), null)
                    : []);
                for (const t of ruleTargets) {
                  this.addEdge({
                    id:
                      `djump_${sourceNodeId}__${t}_L${stmt.sourceLocation.start.line}`,
                    source: sourceNodeId,
                    target: t,
                    kind: "jump",
                    sourceLocation: this.toDomainSourceLocation(
                      stmt.sourceLocation,
                    ),
                  });
                }
                break;
              }
            }
          }
          if (matchedRule) {
            return { hasExit: true };
          }

          const evalRes = evaluatePythonAstExpression(
            stmt.target.trim(),
            { ...this.variableState, ...this.localScope },
          );
          if (
            evalRes.isStaticallyEvaluated && typeof evalRes.value === "string"
          ) {
            const cleanTarget = evalRes.value.replace(/^["']|["']$/g, "")
              .trim();
            this.addEdge({
              id:
                `jump_${sourceNodeId}__${cleanTarget}_L${stmt.sourceLocation.start.line}`,
              source: sourceNodeId,
              target: cleanTarget,
              kind: "jump",
              sourceLocation: this.toDomainSourceLocation(stmt.sourceLocation),
            });
            return { hasExit: true };
          } else if (
            evalRes.stringCandidates && evalRes.stringCandidates.length > 0
          ) {
            for (const cand of evalRes.stringCandidates) {
              const cleanTarget = cand.replace(/^["']|["']$/g, "").trim();
              this.addEdge({
                id:
                  `djump_${sourceNodeId}__${cleanTarget}_L${stmt.sourceLocation.start.line}`,
                source: sourceNodeId,
                target: cleanTarget,
                kind: "jump",
                sourceLocation: this.toDomainSourceLocation(
                  stmt.sourceLocation,
                ),
              });
            }
            return { hasExit: true };
          }

          this.unresolvedDynamicJumps.push({
            sourceNodeId,
            targetExpression: stmt.target.trim(),
            sourceLocation: stmt.sourceLocation,
          });

          const construct = stmt.isPythonOrigin ? "renpy.jump" : "jump";
          this.diagnostics.push({
            code: "dynamic_target",
            severity: "warning",
            location: {
              chapter: this.chapter,
              construct,
              targetExpression: stmt.target.trim(),
              sourceId: sourceNodeId,
            },
            message:
              `Dynamic ${construct} target cannot be resolved statically: ${stmt.target.trim()}`,
            recoveryAction:
              "Use a static string target or configure explicit parser rules.",
          });
          return { hasExit: true };
        }

        this.addEdge({
          id:
            `jump_${sourceNodeId}__${stmt.target}_L${stmt.sourceLocation.start.line}`,
          source: sourceNodeId,
          target: stmt.target,
          kind: "jump",
          sourceLocation: this.toDomainSourceLocation(stmt.sourceLocation),
        });
        return { hasExit: true };
      }

      case "call": {
        let target = stmt.target.trim();
        let isDynamic = stmt.isExpression;

        if (isDynamic) {
          if (
            this.localScope[target] !== undefined &&
            typeof this.localScope[target] === "string"
          ) {
            target = this.localScope[target] as string;
            isDynamic = false;
          } else if (typeof this.variableState[target] === "string") {
            target = this.variableState[target] as string;
            isDynamic = false;
          }
        }

        if (isDynamic) {
          const construct = stmt.isPythonOrigin ? "renpy.call" : "call";
          this.diagnostics.push({
            code: "dynamic_target",
            severity: "warning",
            location: {
              chapter: this.chapter,
              construct,
              targetExpression: stmt.target.trim(),
              sourceId: sourceNodeId,
            },
            message:
              `Dynamic ${construct} target cannot be resolved statically: ${stmt.target.trim()}`,
            recoveryAction:
              "Use a static string target or configure explicit parser rules.",
          });
          return { hasExit: false };
        }

        const isFromDecision = sourceNodeId.startsWith("decision_") ||
          sourceNodeId.startsWith("while_") ||
          sourceNodeId.startsWith("for_");
        const returnTarget = (isFromDecision && postCont && postCont.target)
          ? postCont.target
          : (postCont && postCont.kind === "node" && postCont.target)
          ? postCont.target
          : (this.currentReturnTarget || sourceNodeId);

        const callContext: CallContext = {
          callContextId:
            `call_${sourceNodeId}__${target}_L${stmt.sourceLocation.start.line}`,
          callEdgeId:
            `call_${sourceNodeId}__${target}_L${stmt.sourceLocation.start.line}`,
          callSiteId: sourceNodeId,
          returnTargetId: returnTarget,
          arguments: stmt.arguments as CallArgument[] | undefined,
        };

        this.addEdge({
          id: callContext.callEdgeId,
          source: sourceNodeId,
          target,
          kind: "call",
          label: "call",
          callContext,
          arguments: stmt.arguments as CallArgument[] | undefined,
          sourceLocation: this.toDomainSourceLocation(stmt.sourceLocation),
        });
        return { hasExit: false };
      }

      case "return": {
        return { hasExit: true };
      }

      case "if": {
        return this.processIfStatement(stmt, sourceNodeId, undefined, postCont);
      }

      case "match": {
        return this.processMatchStatement(stmt, sourceNodeId, postCont);
      }

      case "while": {
        return this.processWhileStatement(stmt, sourceNodeId);
      }

      case "for": {
        const decisionId =
          `for_${sourceNodeId}_L${stmt.sourceLocation.start.line}`;
        const expr = `${stmt.variable} in ${stmt.iterable}`;
        this.conditionalExpressions.push({
          branchKind: "for",
          expression: expr,
          sourceId: decisionId,
          sourceLocation: this.toDomainSourceLocation(stmt.sourceLocation),
          chapter: this.chapter,
        });
        const decisionNode: FlowNode = {
          id: decisionId,
          type: "DECISION",
          role: "for_loop",
          label: `for ${expr}`,
          chapter: this.chapter,
          dialogueCount: 0,
          condition: {
            branchKind: "for",
            expression: expr,
            decisionNodeId: decisionId,
          },
          sourceLocation: this.toDomainSourceLocation(stmt.sourceLocation),
        };
        this.addNode(decisionNode);
        this.addEdge({
          id: `seq_${sourceNodeId}__${decisionId}`,
          source: sourceNodeId,
          target: decisionId,
          kind: "sequence",
        });
        for (const bodyStmt of stmt.body) {
          this.processStatement(bodyStmt, decisionId);
        }
        return { hasExit: false };
      }

      case "python": {
        this.applyMutations(stmt.mutations);
        const tc = parseTimedChoice(stmt.code);
        if (tc) {
          this.pendingTimedChoice = {
            duration: tc.duration,
            target: tc.target,
            title: tc.title,
            sourceLocation: stmt.sourceLocation,
          };
        }

        for (const j of stmt.embeddedJumps) {
          let target = j.target.trim();
          let isDynamic = j.isExpression;

          if (isDynamic) {
            let resolvedFromLocal = false;
            if (this.localScope[target] !== undefined) {
              if (typeof this.localScope[target] === "string") {
                target = this.localScope[target] as string;
                isDynamic = false;
              }
              resolvedFromLocal = true;
            }
            if (
              isDynamic && !resolvedFromLocal &&
              typeof this.variableState[target] === "string" &&
              this.initVariables.has(target)
            ) {
              target = this.variableState[target] as string;
              isDynamic = false;
            }
          }

          if (isDynamic) {
            this.diagnostics.push({
              code: "dynamic_target",
              severity: "warning",
              location: {
                chapter: this.chapter,
                construct: "renpy.jump",
                targetExpression: j.target.trim(),
                sourceId: sourceNodeId,
              },
              message:
                `Dynamic renpy.jump target cannot be resolved statically: ${j.target.trim()}`,
              recoveryAction:
                "Use a static string target or configure explicit parser rules.",
            });
          } else {
            this.addEdge({
              id:
                `pjump_${sourceNodeId}__${target}_L${stmt.sourceLocation.start.line}`,
              source: sourceNodeId,
              target,
              kind: "jump",
              sourceLocation: this.toDomainSourceLocation(stmt.sourceLocation),
            });
          }
        }

        for (const c of stmt.embeddedCalls) {
          let target = c.target.trim();
          let isDynamic = c.isExpression;

          if (isDynamic) {
            let resolvedFromLocal = false;
            if (this.localScope[target] !== undefined) {
              if (typeof this.localScope[target] === "string") {
                target = this.localScope[target] as string;
                isDynamic = false;
              }
              resolvedFromLocal = true;
            }
            if (
              isDynamic && !resolvedFromLocal &&
              typeof this.variableState[target] === "string" &&
              this.initVariables.has(target)
            ) {
              target = this.variableState[target] as string;
              isDynamic = false;
            }
          }

          if (isDynamic) {
            this.diagnostics.push({
              code: "dynamic_target",
              severity: "warning",
              location: {
                chapter: this.chapter,
                construct: "renpy.call",
                targetExpression: c.target.trim(),
                sourceId: sourceNodeId,
              },
              message:
                `Dynamic renpy.call target cannot be resolved statically: ${c.target.trim()}`,
              recoveryAction:
                "Use a static string target or configure explicit parser rules.",
            });
          } else {
            const callEdgeId =
              `pcall_${sourceNodeId}__${target}_L${stmt.sourceLocation.start.line}`;
            const callContext: CallContext = {
              callContextId: callEdgeId,
              callEdgeId,
              callSiteId: sourceNodeId,
              returnTargetId: this.currentReturnTarget || sourceNodeId,
            };
            this.addEdge({
              id: callEdgeId,
              source: sourceNodeId,
              target,
              kind: "call",
              label: "call",
              callContext,
              sourceLocation: this.toDomainSourceLocation(stmt.sourceLocation),
            });
          }
        }
        return { hasExit: false };
      }

      case "call_screen": {
        const screenNodeId =
          `screen_call_${sourceNodeId}_${stmt.screenName}_L${stmt.sourceLocation.start.line}`;
        const screenNode: FlowNode = {
          id: screenNodeId,
          type: "SCREEN_CALL",
          role: "screen_call",
          label: `call screen ${stmt.screenName}`,
          chapter: this.chapter,
          dialogueCount: 0,
          sourceLocation: this.toDomainSourceLocation(stmt.sourceLocation),
        };
        this.addNode(screenNode);
        this.addEdge({
          id: `seq_${sourceNodeId}__${screenNodeId}`,
          source: sourceNodeId,
          target: screenNodeId,
          kind: "sequence",
        });

        const screen = this.screens.get(stmt.screenName);
        let screenHasExit = false;
        if (screen) {
          screenHasExit = this.processScreenActions(
            screen.actions,
            screenNodeId,
            stmt.screenName,
            stmt.sourceLocation,
            sourceNodeId,
          );
        }
        return { hasExit: screenHasExit };
      }

      case "screen": {
        this.screens.set(stmt.name, stmt);
        const screenHasExit = this.processScreenActions(
          stmt.actions,
          sourceNodeId,
          stmt.name,
          stmt.sourceLocation,
        );
        return { hasExit: screenHasExit };
      }

      case "generic": {
        const tc = parseTimedChoice(stmt.rawText);
        if (tc) {
          let target = tc.target;
          if (target.startsWith(".") && this.currentGlobalLabel) {
            target = `${this.currentGlobalLabel}${target}`;
          }
          this.pendingTimedChoice = {
            duration: tc.duration,
            target,
            title: tc.title,
            sourceLocation: stmt.sourceLocation,
          };
          return { hasExit: false };
        }

        if (this.activePlugin?.choiceDirectives) {
          for (const cd of this.activePlugin.choiceDirectives) {
            const cdPattern = typeof cd.pattern === "string"
              ? new RegExp(cd.pattern)
              : cd.pattern;
            const match = cdPattern.exec(stmt.rawText);
            if (match) {
              const targetGroupIdx = cd.targetGroup ?? 1;
              let rawTarget = match[targetGroupIdx]?.trim() || "";
              rawTarget = rawTarget.replace(/^["'](.*)["']$/, "$1").trim();
              const duration = cd.durationGroup && match[cd.durationGroup]
                ? parseFloat(match[cd.durationGroup]!)
                : undefined;
              const caption = cd.captionGroup && match[cd.captionGroup]
                ? match[cd.captionGroup]!.replace(/^["'](.*)["']$/, "$1").trim()
                : undefined;
              this.pendingTimedChoice = {
                duration: duration ?? 0,
                target: rawTarget,
                title: caption,
                sourceLocation: stmt.sourceLocation,
              };
              return { hasExit: false };
            }
          }
        }

        if (BUILTIN_TERMINAL_REGEX.test(stmt.rawText)) {
          const node = this.nodes.find((n) => n.id === sourceNodeId);
          if (node) node.isTerminalOutcome = true;
          return { hasExit: true };
        }

        if (this.activePlugin?.terminalStatements) {
          for (const tRule of this.activePlugin.terminalStatements) {
            const tPattern = typeof tRule.pattern === "string"
              ? new RegExp(tRule.pattern)
              : tRule.pattern;
            if (tPattern.test(stmt.rawText)) {
              const node = this.nodes.find((n) => n.id === sourceNodeId);
              if (node && tRule.isTerminalOutcome) {
                node.isTerminalOutcome = true;
              }
              if (tRule.labelHasExplicitExit) {
                return { hasExit: true };
              }
            }
          }
        }

        if (this.activePlugin?.branchStatements) {
          for (const bRule of this.activePlugin.branchStatements) {
            const bPattern = typeof bRule.pattern === "string"
              ? new RegExp(bRule.pattern)
              : bRule.pattern;
            const bMatch = bPattern.exec(stmt.rawText);
            if (bMatch) {
              const targetGroupIdx = bRule.targetGroup ?? 1;
              let rawTarget = bMatch[targetGroupIdx]?.trim() || "";
              rawTarget = rawTarget.replace(/^["'](.*)["']$/, "$1").trim();
              if (rawTarget) {
                this.addEdge({
                  id:
                    `pbranch_${sourceNodeId}__${rawTarget}_L${stmt.sourceLocation.start.line}`,
                  source: sourceNodeId,
                  target: rawTarget,
                  kind: bRule.branchKind,
                  sourceLocation: this.toDomainSourceLocation(
                    stmt.sourceLocation,
                  ),
                });
                if (bRule.suppressFallthrough) {
                  return { hasExit: true };
                }
              }
            }
          }
        }
        return { hasExit: false };
      }

      default:
        return { hasExit: false };
    }
  }

  private processScreenActions(
    actions: ScreenActionAst[],
    sourceNodeId: string,
    screenName: string,
    sourceLocation: AstSourceLocation,
    callingNodeId?: string,
  ): boolean {
    const ruleMap = new Map<string, string>();
    if (this.options.screenActionRules) {
      for (const r of this.options.screenActionRules) {
        ruleMap.set(r.actionName.toLowerCase(), r.actionKind);
      }
    }
    if (this.activePlugin?.defaultScreenActionRules) {
      for (const r of this.activePlugin.defaultScreenActionRules) {
        if (!ruleMap.has(r.actionName.toLowerCase())) {
          ruleMap.set(r.actionName.toLowerCase(), r.actionKind);
        }
      }
    }

    let screenHasExit = false;

    for (const action of actions) {
      const lowerName = action.actionName.toLowerCase();
      const mappedKind = ruleMap.get(lowerName);

      let target = action.target;
      let isDynamic = action.isDynamic ?? false;

      if (!target && action.targetExpression) {
        const trimmed = action.targetExpression.trim();
        if (
          this.localScope[trimmed] !== undefined &&
          typeof this.localScope[trimmed] === "string"
        ) {
          target = this.localScope[trimmed] as string;
          isDynamic = false;
        } else if (typeof this.variableState[trimmed] === "string") {
          target = this.variableState[trimmed] as string;
          isDynamic = false;
        } else {
          isDynamic = true;
        }
      }

      if (mappedKind === "jump" || lowerName === "jump") {
        if (target && !isDynamic) {
          screenHasExit = true;
          this.addEdge({
            id: `screen_jump_${sourceNodeId}__${target}_L${
              action.sourceLocation?.start.line ?? sourceLocation.start.line
            }`,
            source: sourceNodeId,
            target,
            kind: "jump",
            label: `screen: ${screenName}`,
            ...(action.timeout
              ? {
                timeout: {
                  isTimeout: true as const,
                  durationSeconds: action.timeout.durationSeconds,
                },
              }
              : {}),
            sourceLocation: action.sourceLocation
              ? this.toDomainSourceLocation(action.sourceLocation)
              : this.toDomainSourceLocation(sourceLocation),
          });
        } else if (isDynamic) {
          this.diagnostics.push({
            code: "dynamic_target",
            severity: "warning",
            location: {
              chapter: this.chapter,
              construct: action.actionName,
              targetExpression: action.targetExpression || "",
              sourceId: sourceNodeId,
            },
            message:
              `Dynamic ${action.actionName} target cannot be resolved statically: ${action.targetExpression}`,
            recoveryAction:
              "Use a static string target or configure explicit parser rules.",
          });
        }
      } else if (mappedKind === "call" || lowerName === "call") {
        if (target && !isDynamic) {
          screenHasExit = true;
          const edgeId = `screen_call_${sourceNodeId}__${target}_L${
            action.sourceLocation?.start.line ?? sourceLocation.start.line
          }`;
          const callContext: CallContext = {
            callContextId: edgeId,
            callEdgeId: edgeId,
            callSiteId: sourceNodeId,
            returnTargetId: this.currentReturnTarget || sourceNodeId,
          };
          this.addEdge({
            id: edgeId,
            source: sourceNodeId,
            target,
            kind: "call",
            label: `screen: ${screenName}`,
            callContext,
            ...(action.timeout
              ? {
                timeout: {
                  isTimeout: true as const,
                  durationSeconds: action.timeout.durationSeconds,
                },
              }
              : {}),
            sourceLocation: action.sourceLocation
              ? this.toDomainSourceLocation(action.sourceLocation)
              : this.toDomainSourceLocation(sourceLocation),
          });
        } else if (isDynamic) {
          this.diagnostics.push({
            code: "dynamic_target",
            severity: "warning",
            location: {
              chapter: this.chapter,
              construct: action.actionName,
              targetExpression: action.targetExpression || "",
              sourceId: sourceNodeId,
            },
            message:
              `Dynamic ${action.actionName} target cannot be resolved statically: ${action.targetExpression}`,
            recoveryAction:
              "Use a static string target or configure explicit parser rules.",
          });
        }
      } else if (
        mappedKind === "set_variable" || lowerName === "setvariable"
      ) {
        if (action.variableName) {
          const srcNode = this.nodes.find((n) => n.id === sourceNodeId);
          if (srcNode) {
            srcNode.mutations = srcNode.mutations || [];
            srcNode.mutations.push({
              variableName: action.variableName,
              operator: "=",
              value: action.variableValue as VariableMutation["value"],
              rawExpression: `${action.variableName} = ${action.variableValue}`,
              nodeId: sourceNodeId,
              lineNum: action.sourceLocation?.start.line ??
                sourceLocation.start.line,
              isPersistent: action.variableName.startsWith("persistent."),
            });
          }
          this.variableState[action.variableName] = action.variableValue;
          this.localScope[action.variableName] = action.variableValue;
        }
      } else if (
        mappedKind === "toggle_variable" || lowerName === "togglevariable"
      ) {
        if (action.variableName) {
          const srcNode = this.nodes.find((n) => n.id === sourceNodeId);
          if (srcNode) {
            srcNode.mutations = srcNode.mutations || [];
            srcNode.mutations.push({
              variableName: action.variableName,
              operator: "toggle",
              value: null,
              rawExpression:
                `${action.variableName} = not ${action.variableName}`,
              nodeId: sourceNodeId,
              lineNum: action.sourceLocation?.start.line ??
                sourceLocation.start.line,
              isPersistent: action.variableName.startsWith("persistent."),
            });
          }
          this.variableState[action.variableName] = !this
            .variableState[action.variableName];
          this.localScope[action.variableName] = !this
            .localScope[action.variableName];
        }
      } else if (lowerName === "return") {
        const returnTarget = callingNodeId ?? sourceNodeId;
        this.addEdge({
          id: `seq_return_${sourceNodeId}__${returnTarget}`,
          source: sourceNodeId,
          target: returnTarget,
          kind: "sequence",
          label: "return",
          sourceLocation: action.sourceLocation
            ? this.toDomainSourceLocation(action.sourceLocation)
            : this.toDomainSourceLocation(sourceLocation),
        });
      } else if (
        mappedKind === "null_action" ||
        mappedKind === "show" ||
        mappedKind === "hide" ||
        mappedKind === "show_menu" ||
        BUILTIN_IGNORED_ACTIONS.has(lowerName)
      ) {
        // Ignored or null_action
      } else if (!mappedKind) {
        this.diagnostics.push({
          code: "unmapped_screen_action",
          severity: "warning",
          message:
            `Screen action "${action.actionName}" is not mapped to any control flow behavior.`,
          recoveryAction:
            `Map "${action.actionName}" to jump or call in Parser Variant Settings.`,
          location: {
            chapter: action.sourceLocation?.file ?? (this.chapter + ".rpy"),
            lineNum: action.sourceLocation?.start.line ?? 0,
            construct: "screen_action",
            actionName: action.actionName,
            targetExpression: action.rawArgs || undefined,
          },
        });
      }
    }

    return screenHasExit;
  }

  private processWhileStatement(
    stmt: WhileStatementAst,
    sourceNodeId: string,
    inflowCondition?: ConditionMetadata,
  ): { hasExit: boolean } {
    const decisionId =
      `while_${sourceNodeId}_L${stmt.sourceLocation.start.line}`;
    if (stmt.condition) {
      this.conditionalExpressions.push({
        branchKind: "while",
        expression: stmt.condition,
        sourceId: decisionId,
        sourceLocation: this.toDomainSourceLocation(stmt.sourceLocation),
        chapter: this.chapter,
      });
    }
    const decisionNode: FlowNode = {
      id: decisionId,
      type: "DECISION",
      role: "while_loop",
      label: `while ${stmt.condition}`,
      chapter: this.chapter,
      condition: {
        branchKind: "while",
        expression: stmt.condition,
        references: extractConditionFlagRefs(stmt.condition),
        decisionNodeId: decisionId,
      },
      dialogueCount: 0,
      sourceLocation: this.toDomainSourceLocation(stmt.sourceLocation),
    };
    this.addNode(decisionNode);
    this.addEdge({
      id: `seq_${sourceNodeId}__${decisionId}`,
      source: sourceNodeId,
      target: decisionId,
      kind: "sequence",
      ...(inflowCondition ? { condition: inflowCondition } : {}),
      ...(inflowCondition
        ? {
          label: `[${inflowCondition.branchKind}${
            inflowCondition.expression ? " " + inflowCondition.expression : ""
          }]`,
        }
        : {}),
    });
    for (const bodyStmt of stmt.body) {
      this.processStatement(bodyStmt, decisionId);
    }
    return { hasExit: false };
  }

  private processIfStatement(
    stmt: IfStatementAst,
    sourceNodeId: string,
    inflowCondition?: ConditionMetadata,
    postCont?: PostContinuationInfo,
  ): { hasExit: boolean } {
    for (const branch of stmt.branches) {
      if (branch.condition) {
        this.conditionalExpressions.push({
          branchKind: branch.branchKind,
          expression: branch.condition,
          sourceId: sourceNodeId,
          sourceLocation: this.toDomainSourceLocation(branch.sourceLocation),
          chapter: this.chapter,
        });
      }
    }

    const hasBranchExit = stmt.branches.some((b) =>
      this.findTerminalJump(b.body) !== null ||
      b.body.some((s) => s.kind === "return")
    );

    if (this.options.pruneDeadEndDecisions && !hasBranchExit) {
      for (const branch of stmt.branches) {
        for (const s of branch.body) {
          if (s.kind === "say") {
            const srcNode = this.nodes.find((n) => n.id === sourceNodeId);
            if (srcNode) {
              srcNode.dialogueCount++;
              if (s.text) {
                srcNode.dialogueLines = srcNode.dialogueLines || [];
                srcNode.dialogueLines.push(s.text);
              }
            }
          }
        }
      }
      return { hasExit: false };
    }

    const firstBranch = stmt.branches[0]!;
    const decisionId =
      `decision_${sourceNodeId}_L${stmt.sourceLocation.start.line}`;
    const expr = firstBranch.condition || "decision";
    const decisionNode: FlowNode = {
      id: decisionId,
      type: "DECISION",
      role: "decision",
      label: `if ${expr}`,
      chapter: this.chapter,
      condition: {
        branchKind: "if",
        expression: expr,
        references: extractConditionFlagRefs(expr),
        decisionNodeId: decisionId,
      },
      sourceLocation: this.toDomainSourceLocation(stmt.sourceLocation),
      dialogueCount: 0,
    };
    this.addNode(decisionNode);

    this.addEdge({
      id: `seq_${sourceNodeId}__${decisionId}`,
      source: sourceNodeId,
      target: decisionId,
      kind: "sequence",
      ...(inflowCondition ? { condition: inflowCondition } : {}),
      ...(inflowCondition
        ? {
          label: `[${inflowCondition.branchKind}${
            inflowCondition.expression ? " " + inflowCondition.expression : ""
          }]`,
        }
        : {}),
    });

    let allBranchesExit = true;
    for (const branch of stmt.branches) {
      const branchCond: ConditionMetadata = {
        branchKind: branch.branchKind,
        expression: branch.condition,
        references: extractConditionFlagRefs(branch.condition),
        decisionNodeId: decisionId,
      };

      const hasMenu = branch.body.some((s) => s.kind === "menu");
      const jump = this.findTerminalJump(branch.body);
      const isReturn = branch.body.some((s) => s.kind === "return");

      if (jump && !hasMenu) {
        const edgeLabel = branch.condition
          ? `[if ${branch.condition}]`
          : `[${branch.branchKind}]`;
        this.addEdge({
          id:
            `cjump_${decisionId}__${jump.target}_L${branch.sourceLocation.start.line}`,
          source: decisionId,
          target: jump.target,
          kind: "jump",
          label: edgeLabel,
          condition: branchCond,
          sourceLocation: this.toDomainSourceLocation(branch.sourceLocation),
        });
      } else {
        const isCall = branch.body.some((s) => s.kind === "call");
        if (!isReturn && !isCall && !jump) allBranchesExit = false;
        const effectivePostCont: PostContinuationInfo | undefined =
          jump && hasMenu ? { kind: "jump", target: jump.target } : postCont;

        let branchHasMenu = false;
        for (const bodyStmt of branch.body) {
          if (bodyStmt.kind === "menu") {
            branchHasMenu = true;
            const menuContTarget = effectivePostCont?.target || null;
            const menuContKind = (effectivePostCont?.kind === "jump" ||
                effectivePostCont?.kind === "call")
              ? effectivePostCont.kind
              : "sequence";
            this.processMenu(
              bodyStmt,
              decisionId,
              sourceNodeId,
              menuContTarget,
              effectivePostCont?.kind === "next"
                ? (effectivePostCont.target || null)
                : null,
              undefined,
              branchCond,
              menuContKind,
              effectivePostCont?.callStmt,
            );
          } else if (bodyStmt.kind === "if") {
            this.processIfStatement(
              bodyStmt,
              decisionId,
              branchCond,
              effectivePostCont,
            );
          } else if (bodyStmt.kind === "while") {
            this.processWhileStatement(bodyStmt, decisionId, branchCond);
          } else if (bodyStmt.kind !== "jump" || !hasMenu) {
            this.processStatement(bodyStmt, decisionId, effectivePostCont);
          }
        }

        if (!branchHasMenu && !isReturn && !isCall && effectivePostCont) {
          if (effectivePostCont.kind === "jump" && effectivePostCont.target) {
            this.addEdge({
              id:
                `jump_${sourceNodeId}__${effectivePostCont.target}_L${branch.sourceLocation.start.line}`,
              source: sourceNodeId,
              target: effectivePostCont.target,
              kind: "jump",
              sourceLocation: this.toDomainSourceLocation(
                branch.sourceLocation,
              ),
            });
          } else if (
            effectivePostCont.kind === "node" &&
            effectivePostCont.target &&
            effectivePostCont.target !== sourceNodeId
          ) {
            this.addEdge({
              id: `seq_${sourceNodeId}__${effectivePostCont.target}`,
              source: sourceNodeId,
              target: effectivePostCont.target,
              kind: "sequence",
            });
          } else if (
            effectivePostCont.kind === "next" && effectivePostCont.target
          ) {
            this.addEdge({
              id: `fallthrough_${sourceNodeId}__${effectivePostCont.target}`,
              source: sourceNodeId,
              target: effectivePostCont.target,
              kind: "sequence",
              isFallthrough: true,
              label: "next",
            });
          }
        }
      }
    }

    const hasExplicitElse = stmt.branches.some((b) => b.branchKind === "else");
    if (!hasExplicitElse) {
      allBranchesExit = false;
      if (postCont?.kind === "node" && postCont.target) {
        this.addEdge({
          id: `cseq_${decisionId}__${postCont.target}_else`,
          source: decisionId,
          target: postCont.target,
          kind: "sequence",
          label: "else",
          condition: {
            branchKind: "else",
            decisionNodeId: decisionId,
          },
        });
      } else if (postCont?.kind === "next" && postCont.target) {
        this.addEdge({
          id: `fallthrough_${sourceNodeId}__${postCont.target}`,
          source: sourceNodeId,
          target: postCont.target,
          kind: "sequence",
          isFallthrough: true,
          label: "next",
        });
      }
    }

    return {
      hasExit: (allBranchesExit && hasExplicitElse) ||
        (postCont?.kind === "jump" && hasExplicitElse),
    };
  }

  private processMatchStatement(
    stmt: MatchStatementAst,
    sourceNodeId: string,
    postCont?: PostContinuationInfo,
  ): { hasExit: boolean } {
    const decisionId =
      `decision_${sourceNodeId}_L${stmt.sourceLocation.start.line}`;
    const expr = stmt.expression || "match";
    const decisionNode: FlowNode = {
      id: decisionId,
      type: "DECISION",
      role: "decision",
      label: `match ${expr}`,
      chapter: this.chapter,
      condition: {
        branchKind: "match",
        expression: expr,
        references: extractConditionFlagRefs(expr),
        decisionNodeId: decisionId,
      },
      sourceLocation: this.toDomainSourceLocation(stmt.sourceLocation),
      dialogueCount: 0,
    };
    this.addNode(decisionNode);

    this.addEdge({
      id: `seq_${sourceNodeId}__${decisionId}`,
      source: sourceNodeId,
      target: decisionId,
      kind: "sequence",
    });

    let allCasesExit = true;
    for (const c of stmt.cases) {
      let condExpr = c.pattern;
      if (c.pattern && c.pattern !== "_") {
        if (c.pattern.includes("|")) {
          const parts = c.pattern.split("|").map((p) => p.trim());
          const orExpr = parts.map((p) => `((${expr}) == (${p}))`).join(" or ");
          condExpr = `(${orExpr})`;
          if (c.condition) {
            condExpr = `(${condExpr}) and (${c.condition})`;
          }
        } else if (c.condition) {
          if (/^[a-zA-Z_]\w*$/.test(c.pattern)) {
            condExpr = c.condition;
          } else {
            condExpr = `((${expr}) == (${c.pattern})) and (${c.condition})`;
          }
        } else {
          condExpr = `(${expr}) == (${c.pattern})`;
        }
      } else if (c.condition) {
        condExpr = c.condition;
      }

      const caseCond: ConditionMetadata = {
        branchKind: "case",
        expression: condExpr,
        references: extractConditionFlagRefs(condExpr),
        decisionNodeId: decisionId,
      };

      const jump = this.findTerminalJump(c.body);
      const isReturn = c.body.some((s) => s.kind === "return");
      const isCall = c.body.some((s) => s.kind === "call");

      if (jump) {
        this.addEdge({
          id:
            `cjump_${decisionId}__${jump.target}_L${c.sourceLocation.start.line}`,
          source: decisionId,
          target: jump.target,
          kind: "jump",
          label: `case ${c.pattern}`,
          condition: caseCond,
          sourceLocation: this.toDomainSourceLocation(c.sourceLocation),
        });
      } else {
        if (!isReturn && !isCall) allCasesExit = false;
        let caseHasMenu = false;
        for (const bodyStmt of c.body) {
          if (bodyStmt.kind === "menu") {
            caseHasMenu = true;
            this.processMenu(
              bodyStmt,
              decisionId,
              sourceNodeId,
              postCont?.target || null,
              null,
              undefined,
              caseCond,
            );
          } else {
            this.processStatement(bodyStmt, decisionId);
          }
        }

        if (!caseHasMenu && !isReturn && !isCall && postCont?.target) {
          this.addEdge({
            id:
              `cseq_${decisionId}__${postCont.target}_L${c.sourceLocation.start.line}`,
            source: decisionId,
            target: postCont.target,
            kind: "sequence",
            label: `case ${c.pattern}`,
            condition: caseCond,
          });
        }
      }
    }

    return { hasExit: allCasesExit };
  }

  private findTerminalJump(stmts: StatementAst[]): JumpStatementAst | null {
    for (let i = stmts.length - 1; i >= 0; i--) {
      const s = stmts[i]!;
      if (s.kind === "jump") return s;
      if (s.kind === "python" && s.embeddedJumps.length > 0) {
        return s.embeddedJumps[0]!;
      }
    }
    return null;
  }

  private findTerminalCall(stmts: StatementAst[]): CallStatementAst | null {
    for (let i = stmts.length - 1; i >= 0; i--) {
      const s = stmts[i]!;
      if (s.kind === "call") return s;
      if (s.kind === "python" && s.embeddedCalls.length > 0) {
        return s.embeddedCalls[0]!;
      }
    }
    return null;
  }

  private analyzeStatements(
    stmts: StatementAst[],
    labelId?: string,
  ): {
    dialogueCount: number;
    wordCount: number;
    dialogueLines: string[];
    dialogueLineNums: number[];
    characterDialogue: Record<string, { lineCount: number; wordCount: number }>;
    audioAssetCues: AudioAssetCue[];
    mutations: VariableMutation[];
  } {
    const dialogueLines: string[] = [];
    const dialogueLineNums: number[] = [];
    const characterDialogue: Record<
      string,
      { lineCount: number; wordCount: number }
    > = {};
    const audioAssetCues: AudioAssetCue[] = [];
    const mutations: VariableMutation[] = [];
    let wordCount = 0;
    let lastSpeaker: string | undefined;

    for (const stmt of stmts) {
      if (stmt.kind === "say") {
        dialogueLines.push(stmt.text);
        dialogueLineNums.push(stmt.sourceLocation.start.line);

        const words = stmt.text.trim().split(/\s+/).filter(Boolean).length;
        wordCount += words;

        let speaker = stmt.character || "narrator";
        if (speaker === "extend") {
          speaker = lastSpeaker || "narrator";
        } else {
          lastSpeaker = speaker;
        }

        if (!characterDialogue[speaker]) {
          characterDialogue[speaker] = { lineCount: 0, wordCount: 0 };
        }
        characterDialogue[speaker]!.lineCount += 1;
        characterDialogue[speaker]!.wordCount += words;
      } else if (stmt.kind === "asset_cue") {
        const trimmedAsset = (stmt.asset || "").trim();
        if (
          trimmedAsset.length > 0 ||
          (stmt.cueType === "stop" &&
            Boolean(stmt.channel && stmt.channel.trim().length > 0))
        ) {
          audioAssetCues.push({
            type: stmt.cueType as AudioAssetCue["type"],
            channel: stmt.channel,
            asset: stmt.asset,
            raw: stmt.raw,
            lineNum: stmt.sourceLocation.start.line,
            sourceLocation: this.toDomainSourceLocation(stmt.sourceLocation),
          });
        }
      } else if (stmt.kind === "python") {
        const assignedVars = new Set(stmt.mutations.map((m) => m.variableName));
        const pRefs = extractConditionFlagRefs(stmt.code);
        for (const r of pRefs) {
          if (!assignedVars.has(r)) {
            this.pythonReferencedVariables.add(r);
          }
        }
        for (const m of stmt.mutations) {
          let parsedVal: string | number | boolean | null = m.value;
          let isLiteral = m.isLiteral ?? false;
          if (m.operator === "toggle") {
            parsedVal = null;
          } else if (m.value === "True") {
            parsedVal = true;
            isLiteral = true;
          } else if (m.value === "False") {
            parsedVal = false;
            isLiteral = true;
          } else if (/^-?[0-9]+(?:\.[0-9]+)?$/.test(m.value)) {
            parsedVal = Number(m.value);
            isLiteral = true;
          } else if (
            typeof m.value === "string" &&
            ((m.value.startsWith('"') && m.value.endsWith('"')) ||
              (m.value.startsWith("'") && m.value.endsWith("'")))
          ) {
            parsedVal = m.value.slice(1, -1);
            isLiteral = true;
          }

          mutations.push({
            variableName: m.variableName,
            operator: m.operator as VariableMutation["operator"],
            value: parsedVal,
            rawExpression: m.rawExpression,
            nodeId: labelId || "",
            lineNum: stmt.sourceLocation.start.line,
            isPersistent: m.variableName.startsWith("persistent."),
            ...(isLiteral ? { isLiteral } : {}),
          });
        }
      } else if (stmt.kind === "generic") {
        const gRefs = extractConditionFlagRefs(stmt.rawText);
        for (const r of gRefs) {
          this.pythonReferencedVariables.add(r);
        }
        if (this.activePlugin?.variableMutations) {
          for (const vm of this.activePlugin.variableMutations) {
            const vmPattern = typeof vm.pattern === "string"
              ? new RegExp(vm.pattern)
              : vm.pattern;
            const match = vmPattern.exec(stmt.rawText);
            if (match) {
              let varName = vm.variableName;
              if (!varName && vm.variableGroup && match[vm.variableGroup]) {
                varName = match[vm.variableGroup]!;
              }
              let val: string | number | boolean | null =
                vm.constantValue !== undefined ? vm.constantValue : null;
              if (vm.valueGroup && match[vm.valueGroup]) {
                const rawV = match[vm.valueGroup]!.trim();
                val = !isNaN(Number(rawV))
                  ? Number(rawV)
                  : rawV.replace(/^["']|["']$/g, "");
              }
              if (varName) {
                mutations.push({
                  variableName: varName,
                  operator: (vm.operator as VariableMutation["operator"]) ||
                    "+=",
                  value: val,
                  rawExpression: stmt.rawText,
                  nodeId: labelId || "",
                  lineNum: stmt.sourceLocation.start.line,
                  isPersistent: varName.startsWith("persistent."),
                  isLiteral: true,
                });
              }
            }
          }
        }
      }
    }

    return {
      dialogueCount: dialogueLines.length,
      wordCount,
      dialogueLines,
      dialogueLineNums,
      characterDialogue,
      audioAssetCues,
      mutations,
    };
  }

  private addNode(node: FlowNode): void {
    if (!this.nodeIds.has(node.id)) {
      this.nodeIds.add(node.id);
      this.nodes.push(node);
    }
  }

  private addEdge(edge: FlowEdge): void {
    if (!this.edgeIds.has(edge.id)) {
      this.edgeIds.add(edge.id);
      this.edges.push(edge);
    }
  }

  private toDomainSourceLocation(
    loc: StatementAst["sourceLocation"],
  ): SourceLocation {
    return {
      file: loc.file.replace(/\\/g, "/").replace(/\.rpy$/i, ""),
      start: {
        line: loc.start.line,
        character: loc.start.column,
        offset: loc.start.offset,
      },
      end: {
        line: loc.end.line,
        character: loc.end.column,
        offset: loc.end.offset,
      },
    };
  }
}

export function buildStoryGraph(
  ast: RenpyScriptAst,
  options?: BuildGraphOptions,
): GraphBuildResult {
  const builder = new StoryGraphBuilder(ast, options);
  return builder.build();
}
