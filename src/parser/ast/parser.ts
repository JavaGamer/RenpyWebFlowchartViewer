/**
 * src/parser/ast/parser.ts
 *
 * Recursive descent AST parser for Ren'Py scripts.
 * Emits a structured RenpyScriptAst adhering to types.ts.
 */

import type {
  AssetCueStatementAst,
  AstPosition,
  CallArgumentAst,
  CallScreenStatementAst,
  CallStatementAst,
  IfBranchAst,
  IfStatementAst,
  InitStatementAst,
  JumpStatementAst,
  LabelParameterAst,
  LabelStatementAst,
  MenuItemAst,
  MenuStatementAst,
  PassStatementAst,
  PythonBlockAst,
  PythonStatementAst,
  RenpyScriptAst,
  ReturnStatementAst,
  SayStatementAst,
  ScreenActionAst,
  ScreenStatementAst,
  StatementAst,
  Token,
  TokenType,
  TopLevelStatementAst,
  VariableMutationAst,
  WhileStatementAst,
} from "./types.ts";
import { tokenizeRenpy } from "./lexer.ts";

export class RenpyParser {
  private tokens: Token[];
  private file: string;
  private source: string;
  private pos: number = 0;
  private currentGlobalLabel: string = "";

  constructor(tokens: Token[], file: string, source: string = "") {
    this.tokens = tokens;
    this.file = file;
    this.source = source;
  }

  public parse(): RenpyScriptAst {
    const statements: TopLevelStatementAst[] = [];
    this.pos = 0;
    this.currentGlobalLabel = "";

    this.skipNewlines();

    while (!this.isAtEnd()) {
      const stmt = this.parseTopLevelStatement();
      if (stmt) {
        statements.push(stmt);
      }
      this.skipNewlines();
    }

    return {
      file: this.file,
      statements,
    };
  }

  // ==========================================================================
  // Top-Level Statement Parsing
  // ==========================================================================

  private parseTopLevelStatement(): TopLevelStatementAst | null {
    const tok = this.peek();

    if (tok.type === "LABEL") {
      return this.parseLabelStatement();
    }

    if (tok.type === "SCREEN") {
      return this.parseScreenStatement();
    }

    if (tok.type === "INIT") {
      return this.parseInitStatement();
    }

    if (tok.type === "PYTHON") {
      return this.parsePythonBlockStatement();
    }

    // Skip unrecognized token at top level to maintain parser resilience
    this.advance();
    return null;
  }

  // ==========================================================================
  // Label Parsing
  // ==========================================================================

  private parseLabelStatement(): LabelStatementAst {
    const labelTok = this.consume("LABEL", "Expected 'label'");
    const startPos = this.toPosition(labelTok);

    const nameTok = this.consume("IDENTIFIER", "Expected label identifier");
    const rawName = nameTok.value;
    const isLocal = rawName.startsWith(".");

    let canonicalName = rawName;
    if (isLocal) {
      canonicalName = this.currentGlobalLabel
        ? `${this.currentGlobalLabel}${rawName}`
        : rawName;
    } else {
      this.currentGlobalLabel = rawName;
    }

    // Optional parameters: label name(arg1, arg2=val):
    let parameters: LabelParameterAst[] | undefined;
    if (this.check("LPAREN")) {
      parameters = this.parseLabelParameters();
    }

    this.consume("COLON", "Expected ':' after label name");
    this.consume("NEWLINE", "Expected newline after label header");

    const body: StatementAst[] = [];
    let endPos = this.toEndPosition(nameTok);

    if (this.match("INDENT")) {
      while (!this.check("DEDENT") && !this.isAtEnd()) {
        this.skipNewlines();
        if (this.check("DEDENT") || this.isAtEnd()) break;

        const stmt = this.parseStatement();
        if (stmt) {
          body.push(stmt);
          endPos = stmt.sourceLocation.end;
        }
        this.skipNewlines();
      }
      this.match("DEDENT");
    }

    return {
      kind: "label",
      name: rawName,
      canonicalName,
      isLocal,
      ...(parameters ? { parameters } : {}),
      body,
      sourceLocation: {
        file: this.file,
        start: startPos,
        end: endPos,
      },
    };
  }

  private parseLabelParameters(): LabelParameterAst[] {
    this.consume("LPAREN", "Expected '('");
    const params: LabelParameterAst[] = [];

    while (!this.check("RPAREN") && !this.isAtEnd()) {
      if (this.check("IDENTIFIER")) {
        const pName = this.advance().value;
        let defaultVal: string | undefined;
        if (this.match("EQUALS")) {
          defaultVal = this.consumeParameterDefaultValue();
        }
        params.push({
          name: pName,
          ...(defaultVal !== undefined ? { defaultValue: defaultVal } : {}),
        });
      }

      if (!this.match("COMMA")) {
        break;
      }
    }

    this.consume("RPAREN", "Expected ')'");
    return params;
  }

  private consumeParameterDefaultValue(): string {
    let val = "";
    while (
      !this.check("COMMA") &&
      !this.check("RPAREN") &&
      !this.check("NEWLINE") &&
      !this.isAtEnd()
    ) {
      val += this.advance().value;
    }
    return val.trim();
  }

  // ==========================================================================
  // Statement Parsing Inside Blocks
  // ==========================================================================

  private parseStatement(): StatementAst | null {
    const tok = this.peek();

    switch (tok.type) {
      case "STRING":
        return this.parseSayStatement(undefined);

      case "MENU":
        return this.parseMenuStatement();

      case "JUMP":
        return this.parseJumpStatement();

      case "CALL": {
        if (this.peek(1).type === "SCREEN") {
          return this.parseCallScreenStatement();
        }
        return this.parseCallStatement();
      }

      case "RETURN":
        return this.parseReturnStatement();

      case "IF":
        return this.parseIfStatement();

      case "WHILE":
        return this.parseWhileStatement();

      case "DOLLAR":
        return this.parseDollarPythonStatement();

      case "PYTHON":
        return this.parseBlockPythonStatement();

      case "PASS":
        return this.parsePassStatement();

      case "SCENE":
      case "SHOW":
      case "HIDE":
      case "PLAY":
      case "STOP":
      case "QUEUE":
      case "VOICE":
        return this.parseAssetCueStatement();

      case "IDENTIFIER": {
        // Lookahead to see if it's a character speaking: e "Hello" or e happy "Hello"
        if (this.isSaySpeakerAhead()) {
          return this.parseSayWithSpeaker();
        }
        // Otherwise, consume remainder of statement line as generic statement
        return this.skipGenericStatementLine();
      }

      default:
        this.advance();
        return null;
    }
  }

  // ==========================================================================
  // Dialogue / Say Statement
  // ==========================================================================

  private isSaySpeakerAhead(): boolean {
    let offset = 1;
    while (this.pos + offset < this.tokens.length) {
      const t = this.tokens[this.pos + offset]!;
      if (t.type === "STRING") return true;
      if (t.type === "NEWLINE" || t.type === "COLON" || t.type === "EOF") {
        return false;
      }
      offset++;
    }
    return false;
  }

  private parseSayWithSpeaker(): SayStatementAst {
    const speakerTok = this.consume("IDENTIFIER", "Expected speaker name");
    const startPos = this.toPosition(speakerTok);
    const attributes: string[] = [];

    while (this.check("IDENTIFIER") && !this.check("STRING")) {
      attributes.push(this.advance().value);
    }

    const strTok = this.consume("STRING", "Expected dialogue string");
    const endPos = this.toEndPosition(strTok);

    this.consumeStatementTerminator();

    const pauseDuration = this.extractPauseDuration(strTok.value);

    return {
      kind: "say",
      character: speakerTok.value,
      text: strTok.value,
      ...(attributes.length > 0 ? { attributes } : {}),
      ...(pauseDuration !== undefined ? { pauseDuration } : {}),
      sourceLocation: {
        file: this.file,
        start: startPos,
        end: endPos,
      },
    };
  }

  private parseSayStatement(speaker?: string): SayStatementAst {
    const strTok = this.consume("STRING", "Expected dialogue string");
    const startPos = this.toPosition(strTok);
    const endPos = this.toEndPosition(strTok);

    this.consumeStatementTerminator();

    const pauseDuration = this.extractPauseDuration(strTok.value);

    return {
      kind: "say",
      ...(speaker ? { character: speaker } : {}),
      text: strTok.value,
      ...(pauseDuration !== undefined ? { pauseDuration } : {}),
      sourceLocation: {
        file: this.file,
        start: startPos,
        end: endPos,
      },
    };
  }

  private extractPauseDuration(text: string): number | undefined {
    const pauseRegex = /\{w(?:=(\d+(?:\.\d+)?))?\}/g;
    let match: RegExpExecArray | null;
    let totalPause = 0;
    let hasPause = false;

    while ((match = pauseRegex.exec(text)) !== null) {
      hasPause = true;
      totalPause += match[1] ? parseFloat(match[1]) : 0.5;
    }

    return hasPause ? totalPause : undefined;
  }

  // ==========================================================================
  // Menu Statement
  // ==========================================================================

  private parseMenuStatement(): MenuStatementAst {
    const menuTok = this.consume("MENU", "Expected 'menu'");
    const startPos = this.toPosition(menuTok);
    let endPos = this.toEndPosition(menuTok);

    // Menus can have optional arguments like menu (screen="choice"):
    if (this.check("LPAREN")) {
      this.consumeParenthesizedBlock();
    }

    this.consume("COLON", "Expected ':' after menu");
    this.consume("NEWLINE", "Expected newline after menu");

    let prompt: string | undefined;
    let promptSpeaker: string | undefined;
    const items: MenuItemAst[] = [];

    if (this.match("INDENT")) {
      while (!this.check("DEDENT") && !this.isAtEnd()) {
        this.skipNewlines();
        if (this.check("DEDENT") || this.isAtEnd()) break;

        // Check if menu has prompt: e "What to do?" or "What to do?"
        if (
          this.check("IDENTIFIER") &&
          this.peek(1).type === "STRING" &&
          !this.isItemColonAhead(2)
        ) {
          promptSpeaker = this.advance().value;
          prompt = this.consume("STRING", "Expected prompt string").value;
          this.consumeStatementTerminator();
          continue;
        }

        if (this.check("STRING") && !this.isItemColonAhead(1)) {
          prompt = this.consume("STRING", "Expected prompt string").value;
          this.consumeStatementTerminator();
          continue;
        }

        // Standard choice item: "Choice text" if condition:
        if (this.check("STRING")) {
          const item = this.parseMenuItem();
          items.push(item);
          endPos = item.sourceLocation.end;
        } else {
          this.advance();
        }
        this.skipNewlines();
      }
      this.match("DEDENT");
    }

    return {
      kind: "menu",
      ...(prompt ? { prompt } : {}),
      ...(promptSpeaker ? { promptSpeaker } : {}),
      items,
      sourceLocation: {
        file: this.file,
        start: startPos,
        end: endPos,
      },
    };
  }

  private isItemColonAhead(startOffset: number): boolean {
    let offset = startOffset;
    while (this.pos + offset < this.tokens.length) {
      const t = this.tokens[this.pos + offset]!;
      if (t.type === "COLON") return true;
      if (t.type === "NEWLINE" || t.type === "EOF") return false;
      offset++;
    }
    return false;
  }

  private parseMenuItem(): MenuItemAst {
    const textTok = this.consume("STRING", "Expected choice string");
    const itemStartPos = this.toPosition(textTok);
    let itemEndPos = this.toEndPosition(textTok);

    // Optional conditional guard: "Choice" if flag:
    let condition: string | undefined;
    if (this.match("IF")) {
      condition = this.consumeExpressionUntil("COLON");
    }

    this.consume("COLON", "Expected ':' after choice");
    this.consume("NEWLINE", "Expected newline after choice");

    const body: StatementAst[] = [];
    if (this.match("INDENT")) {
      while (!this.check("DEDENT") && !this.isAtEnd()) {
        this.skipNewlines();
        if (this.check("DEDENT") || this.isAtEnd()) break;

        const stmt = this.parseStatement();
        if (stmt) {
          body.push(stmt);
          itemEndPos = stmt.sourceLocation.end;
        }
        this.skipNewlines();
      }
      this.match("DEDENT");
    }

    return {
      text: textTok.value,
      ...(condition ? { condition } : {}),
      body,
      sourceLocation: {
        file: this.file,
        start: itemStartPos,
        end: itemEndPos,
      },
    };
  }

  // ==========================================================================
  // Jump & Call Statements
  // ==========================================================================

  private parseJumpStatement(): JumpStatementAst {
    const jumpTok = this.consume("JUMP", "Expected 'jump'");
    const startPos = this.toPosition(jumpTok);

    let isExpression = false;
    let target: string;

    if (this.matchKeyword("expression")) {
      isExpression = true;
      target = this.consumeExpressionUntilNewline();
    } else {
      const targetTok = this.consume(
        "IDENTIFIER",
        "Expected jump target identifier",
      );
      target = targetTok.value;
    }

    const isLocal = target.startsWith(".");
    if (isLocal && this.currentGlobalLabel) {
      target = `${this.currentGlobalLabel}${target}`;
    }

    const endPos = this.toPosition(this.peek());
    this.consumeStatementTerminator();

    return {
      kind: "jump",
      target,
      isExpression,
      isLocal,
      sourceLocation: {
        file: this.file,
        start: startPos,
        end: endPos,
      },
    };
  }

  private parseCallStatement(): CallStatementAst {
    const callTok = this.consume("CALL", "Expected 'call'");
    const startPos = this.toPosition(callTok);

    let isExpression = false;
    let target: string;

    if (this.matchKeyword("expression")) {
      isExpression = true;
      target = this.consumeExpressionUntilNewline();
    } else {
      const targetTok = this.consume(
        "IDENTIFIER",
        "Expected call target identifier",
      );
      target = targetTok.value;
    }

    const isLocal = target.startsWith(".");
    if (isLocal && this.currentGlobalLabel) {
      target = `${this.currentGlobalLabel}${target}`;
    }

    // Optional call arguments: call target(1, a=2)
    let args: CallArgumentAst[] | undefined;
    if (this.check("LPAREN")) {
      args = this.parseCallArguments();
    }

    // Optional call ... from _call_name
    if (this.matchKeyword("from")) {
      if (this.check("IDENTIFIER")) {
        this.advance();
      }
    }

    const endPos = this.toPosition(this.peek());
    this.consumeStatementTerminator();

    return {
      kind: "call",
      target,
      isExpression,
      isLocal,
      ...(args ? { arguments: args } : {}),
      sourceLocation: {
        file: this.file,
        start: startPos,
        end: endPos,
      },
    };
  }

  private parseCallArguments(): CallArgumentAst[] {
    this.consume("LPAREN", "Expected '('");
    const args: CallArgumentAst[] = [];

    while (!this.check("RPAREN") && !this.isAtEnd()) {
      let name: string | undefined;
      let val = "";

      if (this.check("IDENTIFIER") && this.peek(1).type === "EQUALS") {
        name = this.advance().value;
        this.advance(); // consume '='
      }

      while (
        !this.check("COMMA") &&
        !this.check("RPAREN") &&
        !this.check("NEWLINE") &&
        !this.isAtEnd()
      ) {
        val += this.advance().value;
      }

      args.push({
        ...(name ? { name } : {}),
        value: val.trim(),
      });

      if (!this.match("COMMA")) break;
    }

    this.consume("RPAREN", "Expected ')'");
    return args;
  }

  private parseCallScreenStatement(): CallScreenStatementAst {
    const callTok = this.consume("CALL", "Expected 'call'");
    this.consume("SCREEN", "Expected 'screen'");
    const nameTok = this.consume("IDENTIFIER", "Expected screen name");

    const startPos = this.toPosition(callTok);
    const endPos = this.toEndPosition(nameTok);

    this.consumeStatementTerminator();

    return {
      kind: "call_screen",
      screenName: nameTok.value,
      sourceLocation: {
        file: this.file,
        start: startPos,
        end: endPos,
      },
    };
  }

  // ==========================================================================
  // Return Statement
  // ==========================================================================

  private parseReturnStatement(): ReturnStatementAst {
    const returnTok = this.consume("RETURN", "Expected 'return'");
    const startPos = this.toPosition(returnTok);

    let expr: string | undefined;
    if (!this.check("NEWLINE") && !this.isAtEnd()) {
      expr = this.consumeExpressionUntilNewline();
    }

    const endPos = this.toPosition(this.peek());
    this.consumeStatementTerminator();

    return {
      kind: "return",
      ...(expr ? { expression: expr } : {}),
      sourceLocation: {
        file: this.file,
        start: startPos,
        end: endPos,
      },
    };
  }

  // ==========================================================================
  // If / Elif / Else Statement
  // ==========================================================================

  private parseIfStatement(): IfStatementAst {
    const ifTok = this.consume("IF", "Expected 'if'");
    const startPos = this.toPosition(ifTok);
    let endPos = this.toEndPosition(ifTok);

    const branches: IfBranchAst[] = [];

    // Parse initial 'if' branch
    const ifCond = this.consumeExpressionUntil("COLON");
    this.consume("COLON", "Expected ':' after if condition");
    this.consume("NEWLINE", "Expected newline after if condition");

    const ifBody: StatementAst[] = [];
    if (this.match("INDENT")) {
      while (!this.check("DEDENT") && !this.isAtEnd()) {
        this.skipNewlines();
        if (this.check("DEDENT") || this.isAtEnd()) break;
        const stmt = this.parseStatement();
        if (stmt) {
          ifBody.push(stmt);
          endPos = stmt.sourceLocation.end;
        }
        this.skipNewlines();
      }
      this.match("DEDENT");
    }

    branches.push({
      branchKind: "if",
      condition: ifCond,
      body: ifBody,
      sourceLocation: {
        file: this.file,
        start: startPos,
        end: endPos,
      },
    });

    // Parse optional 'elif' and 'else' branches
    this.skipNewlines();
    while (this.check("ELIF") || this.check("ELSE")) {
      const branchTok = this.advance();
      const branchKind = branchTok.type === "ELIF" ? "elif" : "else";
      const bStart = this.toPosition(branchTok);

      let bCond: string | undefined;
      if (branchKind === "elif") {
        bCond = this.consumeExpressionUntil("COLON");
      }

      this.consume("COLON", `Expected ':' after ${branchKind}`);
      this.consume("NEWLINE", `Expected newline after ${branchKind}`);

      const bBody: StatementAst[] = [];
      let bEnd = this.toEndPosition(branchTok);

      if (this.match("INDENT")) {
        while (!this.check("DEDENT") && !this.isAtEnd()) {
          this.skipNewlines();
          if (this.check("DEDENT") || this.isAtEnd()) break;
          const stmt = this.parseStatement();
          if (stmt) {
            bBody.push(stmt);
            bEnd = stmt.sourceLocation.end;
          }
          this.skipNewlines();
        }
        this.match("DEDENT");
      }

      branches.push({
        branchKind,
        ...(bCond ? { condition: bCond } : {}),
        body: bBody,
        sourceLocation: {
          file: this.file,
          start: bStart,
          end: bEnd,
        },
      });

      endPos = bEnd;
      this.skipNewlines();
    }

    return {
      kind: "if",
      branches,
      sourceLocation: {
        file: this.file,
        start: startPos,
        end: endPos,
      },
    };
  }

  private parseWhileStatement(): WhileStatementAst {
    const whileTok = this.consume("WHILE", "Expected 'while'");
    const startPos = this.toPosition(whileTok);
    const cond = this.consumeExpressionUntil("COLON");

    this.consume("COLON", "Expected ':' after while condition");
    this.consume("NEWLINE", "Expected newline after while condition");

    const body: StatementAst[] = [];
    let endPos = this.toEndPosition(whileTok);

    if (this.match("INDENT")) {
      while (!this.check("DEDENT") && !this.isAtEnd()) {
        this.skipNewlines();
        if (this.check("DEDENT") || this.isAtEnd()) break;
        const stmt = this.parseStatement();
        if (stmt) {
          body.push(stmt);
          endPos = stmt.sourceLocation.end;
        }
        this.skipNewlines();
      }
      this.match("DEDENT");
    }

    return {
      kind: "while",
      condition: cond,
      body,
      sourceLocation: {
        file: this.file,
        start: startPos,
        end: endPos,
      },
    };
  }

  // ==========================================================================
  // Python Statements ($ and python:)
  // ==========================================================================

  private parseDollarPythonStatement(): PythonStatementAst {
    const dollarTok = this.consume("DOLLAR", "Expected '$'");
    const startPos = this.toPosition(dollarTok);

    let rawCode = "";
    if (this.check("RAW_TEXT")) {
      rawCode = this.advance().value;
    }

    const endPos = this.toPosition(this.peek());
    this.consumeStatementTerminator();

    const mutations = this.extractMutationsFromPython(rawCode);
    const jumps = this.extractJumpsFromPython(rawCode, startPos);
    const calls = this.extractCallsFromPython(rawCode, startPos);

    return {
      kind: "python",
      code: rawCode,
      isOneLiner: true,
      mutations,
      embeddedJumps: jumps,
      embeddedCalls: calls,
      sourceLocation: {
        file: this.file,
        start: startPos,
        end: endPos,
      },
    };
  }

  private parseBlockPythonStatement(): PythonStatementAst {
    const pyTok = this.consume("PYTHON", "Expected 'python'");
    const startPos = this.toPosition(pyTok);
    const endPos = this.toEndPosition(pyTok);

    this.consume("COLON", "Expected ':' after python");
    this.consume("NEWLINE", "Expected newline after python");

    let fullCode = "";
    if (this.match("INDENT")) {
      const startOffset = this.peek().offset;
      let lastEndOffset = startOffset;
      while (!this.check("DEDENT") && !this.isAtEnd()) {
        const tok = this.advance();
        lastEndOffset = tok.endOffset;
      }
      this.match("DEDENT");
      if (this.source) {
        fullCode = this.source.slice(startOffset, lastEndOffset).trim();
      }
    }

    const mutations = this.extractMutationsFromPython(fullCode);
    const jumps = this.extractJumpsFromPython(fullCode, startPos);
    const calls = this.extractCallsFromPython(fullCode, startPos);

    return {
      kind: "python",
      code: fullCode.trim(),
      isOneLiner: false,
      mutations,
      embeddedJumps: jumps,
      embeddedCalls: calls,
      sourceLocation: {
        file: this.file,
        start: startPos,
        end: endPos,
      },
    };
  }

  private extractMutationsFromPython(code: string): VariableMutationAst[] {
    const mutations: VariableMutationAst[] = [];
    const mutationRegex =
      /([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*)\s*(\+=|-=|\*=|\/=|%=|=)\s*([^;\n]+)/g;

    let match: RegExpExecArray | null;
    while ((match = mutationRegex.exec(code)) !== null) {
      const varName = match[1]!;
      const op = match[2]!;
      const val = match[3]!.trim();
      mutations.push({
        variableName: varName,
        operator: op,
        value: val,
        rawExpression: `${varName} ${op} ${val}`,
      });
    }

    return mutations;
  }

  private extractJumpsFromPython(
    code: string,
    pos: AstPosition,
  ): JumpStatementAst[] {
    const jumps: JumpStatementAst[] = [];
    const jumpRegex = /renpy\.jump\(\s*["']([^"']+)["']\s*\)/g;

    let match: RegExpExecArray | null;
    while ((match = jumpRegex.exec(code)) !== null) {
      let target = match[1]!;
      const isLocal = target.startsWith(".");
      if (isLocal && this.currentGlobalLabel) {
        target = `${this.currentGlobalLabel}${target}`;
      }
      jumps.push({
        kind: "jump",
        target,
        isExpression: false,
        isLocal,
        isPythonOrigin: true,
        sourceLocation: {
          file: this.file,
          start: pos,
          end: pos,
        },
      });
    }

    return jumps;
  }

  private extractCallsFromPython(
    code: string,
    pos: AstPosition,
  ): CallStatementAst[] {
    const calls: CallStatementAst[] = [];
    const callRegex = /renpy\.call\(\s*["']([^"']+)["']\s*\)/g;

    let match: RegExpExecArray | null;
    while ((match = callRegex.exec(code)) !== null) {
      let target = match[1]!;
      const isLocal = target.startsWith(".");
      if (isLocal && this.currentGlobalLabel) {
        target = `${this.currentGlobalLabel}${target}`;
      }
      calls.push({
        kind: "call",
        target,
        isExpression: false,
        isLocal,
        isPythonOrigin: true,
        sourceLocation: {
          file: this.file,
          start: pos,
          end: pos,
        },
      });
    }

    return calls;
  }

  // ==========================================================================
  // Asset Cues & Pass
  // ==========================================================================

  private parseAssetCueStatement(): AssetCueStatementAst {
    const cueTok = this.advance();
    const startPos = this.toPosition(cueTok);

    let raw = cueTok.value;
    while (!this.check("NEWLINE") && !this.isAtEnd()) {
      raw += " " + this.advance().value;
    }

    const endPos = this.toPosition(this.peek());
    this.consumeStatementTerminator();

    const cueType = cueTok.value
      .toLowerCase() as AssetCueStatementAst["cueType"];
    const assetParts = raw.trim().split(/\s+/).slice(1);
    const asset = assetParts.join(" ");

    return {
      kind: "asset_cue",
      cueType,
      asset,
      raw: raw.trim(),
      sourceLocation: {
        file: this.file,
        start: startPos,
        end: endPos,
      },
    };
  }

  private parsePassStatement(): PassStatementAst {
    const passTok = this.consume("PASS", "Expected 'pass'");
    const startPos = this.toPosition(passTok);
    const endPos = this.toEndPosition(passTok);
    this.consumeStatementTerminator();

    return {
      kind: "pass",
      sourceLocation: {
        file: this.file,
        start: startPos,
        end: endPos,
      },
    };
  }

  // ==========================================================================
  // Screens & Inits
  // ==========================================================================

  private parseScreenStatement(): ScreenStatementAst {
    const screenTok = this.consume("SCREEN", "Expected 'screen'");
    const nameTok = this.consume("IDENTIFIER", "Expected screen name");
    const startPos = this.toPosition(screenTok);
    const endPos = this.toEndPosition(nameTok);

    if (this.check("LPAREN")) {
      this.consumeParenthesizedBlock();
    }
    this.consume("COLON", "Expected ':' after screen");
    this.consume("NEWLINE", "Expected newline after screen");

    const actions: ScreenActionAst[] = [];
    if (this.match("INDENT")) {
      while (!this.check("DEDENT") && !this.isAtEnd()) {
        const line = this.consumeLineAsText();
        const actionMatches = this.extractScreenActions(line);
        actions.push(...actionMatches);
        this.skipNewlines();
      }
      this.match("DEDENT");
    }

    return {
      kind: "screen",
      name: nameTok.value,
      actions,
      sourceLocation: {
        file: this.file,
        start: startPos,
        end: endPos,
      },
    };
  }

  private extractScreenActions(line: string): ScreenActionAst[] {
    const actions: ScreenActionAst[] = [];
    const jumpMatch = /action\s+Jump\(\s*["']([^"']+)["']\s*\)/i.exec(line);
    if (jumpMatch) {
      actions.push({ actionName: "Jump", target: jumpMatch[1] });
    }
    const callMatch = /action\s+Call\(\s*["']([^"']+)["']\s*\)/i.exec(line);
    if (callMatch) {
      actions.push({ actionName: "Call", target: callMatch[1] });
    }
    return actions;
  }

  private parseInitStatement(): InitStatementAst {
    const initTok = this.consume("INIT", "Expected 'init'");
    const startPos = this.toPosition(initTok);
    let priority: number | undefined;

    if (this.check("NUMBER")) {
      priority = parseInt(this.advance().value, 10);
    } else if (this.matchKeyword("offset")) {
      this.consume("EQUALS", "Expected '=' after init offset");
      priority = parseInt(this.consume("NUMBER", "Expected number").value, 10);
    }

    if (this.check("COLON")) {
      this.advance();
    }
    this.consume("NEWLINE", "Expected newline");

    const body: StatementAst[] = [];
    const endPos = this.toEndPosition(initTok);

    if (this.match("INDENT")) {
      while (!this.check("DEDENT") && !this.isAtEnd()) {
        this.skipNewlines();
        if (this.check("DEDENT") || this.isAtEnd()) break;
        const stmt = this.parseStatement();
        if (stmt) body.push(stmt);
        this.skipNewlines();
      }
      this.match("DEDENT");
    }

    return {
      kind: "init",
      ...(priority !== undefined ? { priority } : {}),
      body,
      sourceLocation: {
        file: this.file,
        start: startPos,
        end: endPos,
      },
    };
  }

  private parsePythonBlockStatement(): PythonBlockAst {
    const pyTok = this.consume("PYTHON", "Expected 'python'");
    const startPos = this.toPosition(pyTok);
    let isEarly = false;
    if (this.matchKeyword("early")) {
      isEarly = true;
    }

    this.consume("COLON", "Expected ':'");
    this.consume("NEWLINE", "Expected newline");

    let code = "";
    const endPos = this.toEndPosition(pyTok);

    if (this.match("INDENT")) {
      while (!this.check("DEDENT") && !this.isAtEnd()) {
        code += this.advance().value + " ";
        if (this.check("NEWLINE")) {
          code += "\n";
          this.advance();
        }
      }
      this.match("DEDENT");
    }

    return {
      kind: "python_block",
      isEarly,
      code: code.trim(),
      sourceLocation: {
        file: this.file,
        start: startPos,
        end: endPos,
      },
    };
  }

  // ==========================================================================
  // Utility & Parsing Helpers
  // ==========================================================================

  private consumeParenthesizedBlock(): void {
    if (!this.match("LPAREN")) return;
    let depth = 1;
    while (depth > 0 && !this.isAtEnd()) {
      if (this.check("LPAREN")) depth++;
      else if (this.check("RPAREN")) depth--;
      this.advance();
    }
  }

  private consumeExpressionUntil(terminator: TokenType): string {
    const startOffset = this.peek().offset;
    let lastEndOffset = startOffset;
    let fallback = "";
    while (
      !this.check(terminator) && !this.check("NEWLINE") && !this.isAtEnd()
    ) {
      const tok = this.advance();
      fallback += tok.value + " ";
      lastEndOffset = tok.endOffset;
    }
    if (this.source && lastEndOffset > startOffset) {
      return this.source.slice(startOffset, lastEndOffset).trim();
    }
    return fallback.trim();
  }

  private consumeExpressionUntilNewline(): string {
    const startOffset = this.peek().offset;
    let lastEndOffset = startOffset;
    let fallback = "";
    while (!this.check("NEWLINE") && !this.isAtEnd()) {
      const tok = this.advance();
      fallback += tok.value + " ";
      lastEndOffset = tok.endOffset;
    }
    if (this.source && lastEndOffset > startOffset) {
      return this.source.slice(startOffset, lastEndOffset).trim();
    }
    return fallback.trim();
  }

  private consumeLineAsText(): string {
    let line = "";
    while (!this.check("NEWLINE") && !this.isAtEnd()) {
      line += this.advance().value + " ";
    }
    this.consumeStatementTerminator();
    return line.trim();
  }

  private skipGenericStatementLine(): StatementAst | null {
    while (!this.check("NEWLINE") && !this.isAtEnd()) {
      this.advance();
    }
    this.consumeStatementTerminator();
    return null;
  }

  private consumeStatementTerminator(): void {
    if (this.check("NEWLINE")) {
      this.advance();
    }
  }

  private skipNewlines(): void {
    while (this.check("NEWLINE")) {
      this.advance();
    }
  }

  private peek(offset: number = 0): Token {
    const idx = this.pos + offset;
    return idx < this.tokens.length
      ? this.tokens[idx]!
      : this.tokens[this.tokens.length - 1]!;
  }

  private check(type: TokenType): boolean {
    if (this.isAtEnd()) return type === "EOF";
    return this.peek().type === type;
  }

  private match(...types: TokenType[]): boolean {
    for (const type of types) {
      if (this.check(type)) {
        this.advance();
        return true;
      }
    }
    return false;
  }

  private matchKeyword(val: string): boolean {
    if (this.peek().value === val) {
      this.advance();
      return true;
    }
    return false;
  }

  private consume(type: TokenType, errMsg: string): Token {
    if (this.check(type)) {
      return this.advance();
    }
    throw new Error(
      `Parse error in ${this.file} at line ${
        this.peek().line + 1
      }: ${errMsg}. Got '${this.peek().value}' (${this.peek().type})`,
    );
  }

  private advance(): Token {
    if (!this.isAtEnd()) {
      this.pos++;
    }
    return this.tokens[this.pos - 1]!;
  }

  private isAtEnd(): boolean {
    return this.pos >= this.tokens.length || this.peek().type === "EOF";
  }

  private toPosition(tok: Token): AstPosition {
    return {
      line: tok.line,
      column: tok.column,
      offset: tok.offset,
    };
  }

  private toEndPosition(tok: Token): AstPosition {
    return {
      line: tok.line,
      column: tok.column + tok.value.length,
      offset: tok.endOffset,
    };
  }
}

export function parseRenpyScript(
  source: string,
  filePath: string = "script.rpy",
): RenpyScriptAst {
  const tokens = tokenizeRenpy(source);
  const parser = new RenpyParser(tokens, filePath, source);
  return parser.parse();
}
