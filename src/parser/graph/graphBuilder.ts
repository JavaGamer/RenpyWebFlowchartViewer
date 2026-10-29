/**
 * src/parser/graph/graphBuilder.ts
 *
 * Story Graph Builder: Transforms RenpyScriptAst into clean FlowNode[] and FlowEdge[].
 * Adheres strictly to the domain model in src/domain/graph.ts.
 */

import type {
  AudioAssetCue,
  CallContext,
  ConditionMetadata,
  FlowEdge,
  FlowNode,
  LabelParameter,
  SourceLocation,
  VariableMutation,
} from "../../domain/graph.ts";
import type {
  CallStatementAst,
  IfStatementAst,
  JumpStatementAst,
  LabelStatementAst,
  MenuItemAst,
  MenuStatementAst,
  RenpyScriptAst,
  ScreenStatementAst,
  StatementAst,
} from "../ast/types.ts";

export interface BuildGraphOptions {
  screens?: Map<string, ScreenStatementAst>;
}

export interface GraphBuildResult {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

export class StoryGraphBuilder {
  private ast: RenpyScriptAst;
  private chapter: string;
  private screens: Map<string, ScreenStatementAst>;

  private nodes: FlowNode[] = [];
  private edges: FlowEdge[] = [];
  private nodeIds: Set<string> = new Set();
  private edgeIds: Set<string> = new Set();

  constructor(ast: RenpyScriptAst, options: BuildGraphOptions = {}) {
    this.ast = ast;
    this.chapter = ast.file.replace(/\\/g, "/").replace(/\.rpy$/i, "");
    this.screens = options.screens ?? new Map();

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
    this.nodeIds.clear();
    this.edgeIds.clear();

    const labelStatements = this.ast.statements.filter(
      (s): s is LabelStatementAst => s.kind === "label",
    );

    // Track which nodes terminate unconditionally to handle fallthrough
    const labelTerminalExits = new Map<string, boolean>();

    for (let i = 0; i < labelStatements.length; i++) {
      const labelStmt = labelStatements[i]!;
      const { finalNodeId, hasExit } = this.processLabel(labelStmt);
      labelTerminalExits.set(finalNodeId, hasExit);

      // Check for implicit fallthrough to the subsequent label in the same file
      if (!hasExit && i + 1 < labelStatements.length) {
        const nextLabelStmt = labelStatements[i + 1]!;
        const nextId = nextLabelStmt.canonicalName;
        this.addEdge({
          id: `fallthrough_${finalNodeId}__${nextId}`,
          source: finalNodeId,
          target: nextId,
          kind: "fallthrough",
          isFallthrough: true,
          label: "fallthrough",
        });
      } else if (!hasExit && i + 1 === labelStatements.length) {
        // Last label in file with no exit is a terminal outcome
        const finalNode = this.nodes.find((n) => n.id === finalNodeId);
        if (finalNode) {
          finalNode.isTerminalOutcome = true;
        }
      }
    }

    return {
      nodes: this.nodes,
      edges: this.edges,
    };
  }

  private processLabel(labelStmt: LabelStatementAst): {
    finalNodeId: string;
    hasExit: boolean;
  } {
    const labelId = labelStmt.canonicalName;

    // Separate pre-menu statements from post-menu statements if a menu exists
    const menuIdx = labelStmt.body.findIndex((s) => s.kind === "menu");
    const preMenuStmts = menuIdx !== -1
      ? labelStmt.body.slice(0, menuIdx)
      : labelStmt.body;
    const menuStmt = menuIdx !== -1
      ? (labelStmt.body[menuIdx] as MenuStatementAst)
      : null;
    const postMenuStmts = menuIdx !== -1
      ? labelStmt.body.slice(menuIdx + 1)
      : [];

    // Aggregate primary dialogue and metrics for the main LabelNode
    const primaryMetrics = this.analyzeStatements(preMenuStmts);

    const labelNode: FlowNode = {
      id: labelId,
      type: "LABEL",
      role: primaryMetrics.dialogueLines.length > 0 ? "story" : "utility",
      label: labelStmt.name,
      dialogueCount: primaryMetrics.dialogueCount,
      wordCount: primaryMetrics.wordCount,
      dialogueLines: primaryMetrics.dialogueLines,
      dialogueLineNums: primaryMetrics.dialogueLineNums,
      characterDialogue: primaryMetrics.characterDialogue,
      audioAssetCues: primaryMetrics.audioAssetCues,
      mutations: primaryMetrics.mutations,
      chapter: this.chapter,
      sourceLocation: this.toDomainSourceLocation(labelStmt.sourceLocation),
      ...(labelStmt.parameters
        ? { parameters: labelStmt.parameters as LabelParameter[] }
        : {}),
    };
    this.addNode(labelNode);

    let currentNodeId = labelId;
    let hasTerminalExit = false;

    // Process pre-menu statements for jumps/calls
    for (const stmt of preMenuStmts) {
      const exitInfo = this.processStatement(stmt, currentNodeId);
      if (exitInfo.hasExit) hasTerminalExit = true;
    }

    // Process menu if present
    if (menuStmt) {
      // Check if any choice falls through (does not jump/return)
      let continuationNodeId: string | null = null;
      if (postMenuStmts.length > 0) {
        const hasContinuingChoice = menuStmt.items.some((item) =>
          !this.itemHasTerminalJumpOrReturn(item)
        );

        if (hasContinuingChoice) {
          const firstPostStmt = postMenuStmts[0]!;
          continuationNodeId =
            `${labelId}__cont_L${firstPostStmt.sourceLocation.start.line}`;
          const postMetrics = this.analyzeStatements(postMenuStmts);

          const contNode: FlowNode = {
            id: continuationNodeId,
            type: "LABEL",
            role: "story",
            label: `${labelStmt.name} (cont)`,
            dialogueCount: postMetrics.dialogueCount,
            wordCount: postMetrics.wordCount,
            dialogueLines: postMetrics.dialogueLines,
            dialogueLineNums: postMetrics.dialogueLineNums,
            characterDialogue: postMetrics.characterDialogue,
            audioAssetCues: postMetrics.audioAssetCues,
            mutations: postMetrics.mutations,
            chapter: this.chapter,
            sourceLocation: this.toDomainSourceLocation(
              firstPostStmt.sourceLocation,
            ),
          };
          this.addNode(contNode);
        }
      }

      const allChoicesExit = this.processMenu(
        menuStmt,
        currentNodeId,
        labelId,
        continuationNodeId,
      );

      if (continuationNodeId) {
        currentNodeId = continuationNodeId;
        hasTerminalExit = false;
        for (const stmt of postMenuStmts) {
          const exitInfo = this.processStatement(stmt, currentNodeId);
          if (exitInfo.hasExit) hasTerminalExit = true;
        }
      } else {
        hasTerminalExit = allChoicesExit;
      }
    }

    return {
      finalNodeId: currentNodeId,
      hasExit: hasTerminalExit,
    };
  }

  private processMenu(
    menuStmt: MenuStatementAst,
    sourceNodeId: string,
    labelId: string,
    continuationNodeId: string | null,
    inflowLabel?: string,
    inflowCondition?: ConditionMetadata,
  ): boolean {
    const menuNodeId = `menu_${labelId}_L${menuStmt.sourceLocation.start.line}`;
    const menuNode: FlowNode = {
      id: menuNodeId,
      type: "MENU",
      role: "menu",
      label: menuStmt.prompt || "Choice",
      dialogueCount: menuStmt.prompt ? 1 : 0,
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

    let allChoicesExit = menuStmt.items.length > 0;

    for (let cIdx = 0; cIdx < menuStmt.items.length; cIdx++) {
      const item = menuStmt.items[cIdx]!;
      const nestedMenu = item.body.find(
        (s): s is MenuStatementAst => s.kind === "menu",
      );
      const jumpStmt = this.findTerminalJump(item.body);
      const callStmt = this.findTerminalCall(item.body);

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
          item.text,
          conditionMeta,
        );
        if (!nestedExit) allChoicesExit = false;
      } else if (jumpStmt) {
        this.addEdge({
          id: `choice_${menuNodeId}__${jumpStmt.target}_c${cIdx}`,
          source: menuNodeId,
          target: jumpStmt.target,
          kind: "jump",
          label: item.text,
          ...(conditionMeta ? { condition: conditionMeta } : {}),
          sourceLocation: this.toDomainSourceLocation(item.sourceLocation),
        });
      } else if (callStmt) {
        const retTarget = continuationNodeId ?? labelId;
        const callContext: CallContext = {
          callContextId: `call_${menuNodeId}__${callStmt.target}_c${cIdx}`,
          callEdgeId: `call_${menuNodeId}__${callStmt.target}_c${cIdx}`,
          callSiteId: menuNodeId,
          returnTargetId: retTarget,
          arguments: callStmt.arguments,
        };

        this.addEdge({
          id: callContext.callEdgeId,
          source: menuNodeId,
          target: callStmt.target,
          kind: "call",
          label: item.text,
          callContext,
          ...(conditionMeta ? { condition: conditionMeta } : {}),
          sourceLocation: this.toDomainSourceLocation(item.sourceLocation),
        });
      } else if (continuationNodeId) {
        allChoicesExit = false;
        this.addEdge({
          id: `choice_${menuNodeId}__${continuationNodeId}_c${cIdx}`,
          source: menuNodeId,
          target: continuationNodeId,
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

  private processStatement(
    stmt: StatementAst,
    sourceNodeId: string,
  ): { hasExit: boolean } {
    switch (stmt.kind) {
      case "jump": {
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
        const callContext: CallContext = {
          callContextId:
            `call_${sourceNodeId}__${stmt.target}_L${stmt.sourceLocation.start.line}`,
          callEdgeId:
            `call_${sourceNodeId}__${stmt.target}_L${stmt.sourceLocation.start.line}`,
          callSiteId: sourceNodeId,
          returnTargetId: sourceNodeId,
          arguments: stmt.arguments,
        };

        this.addEdge({
          id: callContext.callEdgeId,
          source: sourceNodeId,
          target: stmt.target,
          kind: "call",
          callContext,
          sourceLocation: this.toDomainSourceLocation(stmt.sourceLocation),
        });
        return { hasExit: false };
      }

      case "return": {
        return { hasExit: true };
      }

      case "if": {
        this.processIfStatement(stmt, sourceNodeId);
        const hasElse = stmt.branches.some((b) => b.branchKind === "else");
        const allBranchesJump = hasElse &&
          stmt.branches.every((b) => this.findTerminalJump(b.body) !== null);
        return { hasExit: allBranchesJump };
      }

      case "python": {
        for (const j of stmt.embeddedJumps) {
          this.addEdge({
            id:
              `pjump_${sourceNodeId}__${j.target}_L${stmt.sourceLocation.start.line}`,
            source: sourceNodeId,
            target: j.target,
            kind: "jump",
            sourceLocation: this.toDomainSourceLocation(stmt.sourceLocation),
          });
        }
        for (const c of stmt.embeddedCalls) {
          this.addEdge({
            id:
              `pcall_${sourceNodeId}__${c.target}_L${stmt.sourceLocation.start.line}`,
            source: sourceNodeId,
            target: c.target,
            kind: "call",
            sourceLocation: this.toDomainSourceLocation(stmt.sourceLocation),
          });
        }
        return { hasExit: stmt.embeddedJumps.length > 0 };
      }

      case "call_screen": {
        const screen = this.screens.get(stmt.screenName);
        if (screen) {
          for (const action of screen.actions) {
            if (action.actionName === "Jump" && action.target) {
              this.addEdge({
                id:
                  `screen_jump_${sourceNodeId}__${action.target}_L${stmt.sourceLocation.start.line}`,
                source: sourceNodeId,
                target: action.target,
                kind: "jump",
                label: `screen: ${stmt.screenName}`,
                sourceLocation: this.toDomainSourceLocation(
                  stmt.sourceLocation,
                ),
              });
            } else if (action.actionName === "Call" && action.target) {
              this.addEdge({
                id:
                  `screen_call_${sourceNodeId}__${action.target}_L${stmt.sourceLocation.start.line}`,
                source: sourceNodeId,
                target: action.target,
                kind: "call",
                label: `screen: ${stmt.screenName}`,
                sourceLocation: this.toDomainSourceLocation(
                  stmt.sourceLocation,
                ),
              });
            }
          }
        }
        return { hasExit: false };
      }

      default:
        return { hasExit: false };
    }
  }

  private processIfStatement(stmt: IfStatementAst, sourceNodeId: string): void {
    for (const branch of stmt.branches) {
      const jump = this.findTerminalJump(branch.body);
      if (jump) {
        const condMeta: ConditionMetadata = {
          branchKind: branch.branchKind,
          expression: branch.condition,
          decisionNodeId: sourceNodeId,
        };

        const edgeLabel = branch.condition
          ? `[if ${branch.condition}]`
          : `[${branch.branchKind}]`;

        this.addEdge({
          id:
            `cjump_${sourceNodeId}__${jump.target}_L${branch.sourceLocation.start.line}`,
          source: sourceNodeId,
          target: jump.target,
          kind: "jump",
          label: edgeLabel,
          condition: condMeta,
          sourceLocation: this.toDomainSourceLocation(branch.sourceLocation),
        });
      }
    }
  }

  private itemHasTerminalJumpOrReturn(item: MenuItemAst): boolean {
    return (
      this.findTerminalJump(item.body) !== null ||
      item.body.some((s) => s.kind === "return")
    );
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

  private analyzeStatements(stmts: StatementAst[]): {
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

    for (const stmt of stmts) {
      if (stmt.kind === "say") {
        dialogueLines.push(stmt.text);
        dialogueLineNums.push(stmt.sourceLocation.start.line);

        const words = stmt.text.trim().split(/\s+/).filter(Boolean).length;
        wordCount += words;

        const speaker = stmt.character || "narrator";
        if (!characterDialogue[speaker]) {
          characterDialogue[speaker] = { lineCount: 0, wordCount: 0 };
        }
        characterDialogue[speaker]!.lineCount += 1;
        characterDialogue[speaker]!.wordCount += words;
      } else if (stmt.kind === "asset_cue") {
        audioAssetCues.push({
          type: stmt.cueType as AudioAssetCue["type"],
          channel: stmt.channel,
          asset: stmt.asset,
          raw: stmt.raw,
          lineNum: stmt.sourceLocation.start.line,
        });
      } else if (stmt.kind === "python") {
        for (const m of stmt.mutations) {
          mutations.push({
            variableName: m.variableName,
            operator: m.operator as VariableMutation["operator"],
            value: m.value,
            rawExpression: m.rawExpression,
            nodeId: "",
            lineNum: stmt.sourceLocation.start.line,
            isPersistent: m.variableName.startsWith("persistent."),
          });
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
      file: loc.file,
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
