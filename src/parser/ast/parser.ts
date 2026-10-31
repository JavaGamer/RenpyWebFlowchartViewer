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
  CaseBranchAst,
  DefaultStatementAst,
  DefineStatementAst,
  ForStatementAst,
  GenericStatementAst,
  IfBranchAst,
  IfStatementAst,
  ImageStatementAst,
  InitStatementAst,
  JumpStatementAst,
  LabelParameterAst,
  LabelStatementAst,
  MatchStatementAst,
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
import { getParserVariantPlugins } from "../plugins/pluginRegistry.ts";
import { extractLiteralTarget, extractSceneAsset } from "../utils.ts";

export class RenpyParser {
  private tokens: Token[];
  private file: string;
  private source: string;
  private pos: number = 0;
  private currentGlobalLabel: string = "";
  private nonSpeakerKeywords: Set<string>;

  private fileInitOffset: number = 0;

  constructor(
    tokens: Token[],
    file: string,
    source: string = "",
    options?: { parserVariant?: string },
  ) {
    this.tokens = tokens;
    this.file = file;
    this.source = source;
    this.fileInitOffset = 0;
    this.nonSpeakerKeywords = new Set<string>([
      "gameover",
      "title",
      "timedchoice",
      "routename",
    ]);

    const variant = options?.parserVariant;
    if (variant && variant !== "renpy") {
      try {
        const plugins = getParserVariantPlugins();
        const activePlugin = plugins.find((p) => p.id === variant);
        if (activePlugin) {
          if (activePlugin.id === "st") {
            this.nonSpeakerKeywords.add("placeholder");
          }
          if (activePlugin.branchStatements) {
            for (const b of activePlugin.branchStatements) {
              const src = typeof b.pattern === "string"
                ? b.pattern
                : b.pattern.source;
              const clean = src.replace(/^\^/, "").replace(
                /^(?:\\s|\s)*[+*]?/,
                "",
              ).replace(/^\\\$/, "").trim();
              const m = /^[A-Za-z0-9_]+/.exec(clean);
              if (m) this.nonSpeakerKeywords.add(m[0].toLowerCase());
            }
          }
          if (activePlugin.terminalStatements) {
            for (const t of activePlugin.terminalStatements) {
              const src = typeof t.pattern === "string"
                ? t.pattern
                : t.pattern.source;
              const clean = src.replace(/^\^/, "").replace(
                /^(?:\\s|\s)*[+*]?/,
                "",
              ).replace(/^\\\$/, "").trim();
              const m = /^[A-Za-z0-9_]+/.exec(clean);
              if (m) this.nonSpeakerKeywords.add(m[0].toLowerCase());
            }
          }
          if (activePlugin.stagingKeywords) {
            for (const kw of activePlugin.stagingKeywords) {
              this.nonSpeakerKeywords.add(kw.toLowerCase());
            }
          }
        }
      } catch {
        // Ignore if plugins registry is not yet initialized
      }
    }
  }

  public parse(): RenpyScriptAst {
    const statements: TopLevelStatementAst[] = [];
    this.pos = 0;
    this.currentGlobalLabel = "";
    this.fileInitOffset = 0;

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
    try {
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

      if (tok.type === "IDENTIFIER") {
        if (tok.value === "define") {
          return this.parseDefineStatement();
        }
        if (tok.value === "default") {
          return this.parseDefaultStatement();
        }
        if (tok.value === "image") {
          return this.parseImageStatement();
        }
        if (tok.value === "python") {
          return this.parsePythonBlockStatement();
        }
      }

      if (
        tok.type === "MENU" ||
        (tok.type === "IDENTIFIER" && tok.value.toLowerCase() === "menu")
      ) {
        return this.parseMenuStatement();
      }

      if (tok.type === "DOLLAR") {
        const stmt = this.parseDollarPythonStatement();
        return {
          kind: "init",
          priority: this.fileInitOffset,
          body: [stmt],
          sourceLocation: stmt.sourceLocation,
        };
      }

      // Skip unrecognized token at top level to maintain parser resilience
      this.advance();
      return null;
    } catch {
      this.advance();
      return null;
    }
  }

  // ==========================================================================
  // Label Parsing
  // ==========================================================================

  private parseLabelStatement(): LabelStatementAst {
    const labelTok = this.consume("LABEL", "Expected 'label'");
    const startPos = this.toPosition(labelTok);

    const nameTok = this.consumeIdentifierLike("Expected label identifier");
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

    this.match("COLON");

    const body: StatementAst[] = [];
    let endPos = this.toEndPosition(nameTok);

    if (!this.check("NEWLINE") && !this.isAtEnd()) {
      // Single-line label statement, e.g. "label start: return"
      const stmt = this.parseStatement();
      if (stmt) {
        body.push(stmt);
        endPos = stmt.sourceLocation.end;
      }
    } else {
      this.consumeStatementTerminator();
      if (this.match("INDENT")) {
        while (!this.check("DEDENT") && !this.isAtEnd()) {
          this.skipNewlines();
          if (this.check("DEDENT") || this.isAtEnd()) break;

          try {
            const stmt = this.parseStatement();
            if (stmt) {
              body.push(stmt);
              endPos = stmt.sourceLocation.end;
            }
          } catch {
            while (
              !this.check("NEWLINE") && !this.check("DEDENT") && !this.isAtEnd()
            ) {
              this.advance();
            }
          }
          this.skipNewlines();
        }
        this.match("DEDENT");
      }
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

      case "FOR":
        return this.parseForStatement();

      case "DOLLAR":
        return this.parseDollarPythonStatement();

      case "PYTHON":
        return this.parseBlockPythonStatement();

      case "SCREEN":
        return this.parseScreenStatement();

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
        if (this.peek().value === "match") {
          return this.parseMatchStatement();
        }
        // Otherwise, consume remainder of statement line as generic statement
        return this.parseGenericStatement();
      }

      default:
        this.advance();
        return null;
    }
  }

  // ==========================================================================
  // Dialogue / Say Statement
  // ==========================================================================

  private isNonSpeakerKeyword(word: string): boolean {
    return this.nonSpeakerKeywords.has(word);
  }

  private isSaySpeakerAhead(): boolean {
    const firstWord = this.peek().value.toLowerCase();
    if (this.isNonSpeakerKeyword(firstWord)) {
      return false;
    }
    let offset = 1;
    while (this.pos + offset < this.tokens.length) {
      const t = this.tokens[this.pos + offset]!;
      if (t.type === "STRING") return true;
      if (t.type !== "IDENTIFIER") {
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
    const firstTok = this.consume("STRING", "Expected dialogue string");
    const startPos = this.toPosition(firstTok);
    let endPos = this.toEndPosition(firstTok);

    let actualSpeaker = speaker;
    let actualText = firstTok.value;

    // Handle "Speaker" "Dialogue" syntax
    if (!speaker && this.check("STRING")) {
      actualSpeaker = firstTok.value;
      const secondTok = this.advance();
      actualText = secondTok.value;
      endPos = this.toEndPosition(secondTok);
    }

    this.consumeStatementTerminator();

    const pauseDuration = this.extractPauseDuration(actualText);

    return {
      kind: "say",
      ...(actualSpeaker ? { character: actualSpeaker } : {}),
      text: actualText,
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

    let menuName: string | undefined;
    if (
      !this.check("COLON") && !this.check("LPAREN") && !this.check("NEWLINE")
    ) {
      const nameTok = this.consumeIdentifierLike("Expected menu name");
      menuName = nameTok.value;
      endPos = this.toEndPosition(nameTok);
    }

    // Menus can have optional arguments like menu (screen="choice"):
    if (this.check("LPAREN")) {
      this.consumeParenthesizedBlock();
    }

    this.match("COLON");
    this.consumeStatementTerminator();

    let prompt: string | undefined;
    const prompts: string[] = [];
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
          if (!promptSpeaker) promptSpeaker = this.advance().value;
          else this.advance();
          const str = this.consume("STRING", "Expected prompt string").value;
          prompts.push(str);
          if (!prompt) prompt = str;
          this.consumeStatementTerminator();
          continue;
        }

        if (this.check("STRING") && !this.isItemColonAhead(1)) {
          const str = this.consume("STRING", "Expected prompt string").value;
          prompts.push(str);
          if (!prompt) prompt = str;
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
      ...(menuName ? { name: menuName } : {}),
      ...(prompt ? { prompt } : {}),
      ...(prompts.length > 0 ? { prompts } : {}),
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

    this.match("COLON");
    this.consumeStatementTerminator();

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
      const targetTok = this.consumeIdentifierLike(
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
      const targetTok = this.consumeIdentifierLike(
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

    let screenName: string;
    let endTok: Token;
    if (this.matchKeyword("expression")) {
      if (this.check("STRING")) {
        endTok = this.advance();
        screenName = endTok.value;
      } else {
        screenName = this.consumeExpressionUntilNewline();
        endTok = this.peek();
      }
    } else {
      endTok = this.consumeIdentifierLike("Expected screen name");
      screenName = endTok.value;
    }

    const startPos = this.toPosition(callTok);
    const endPos = this.toEndPosition(endTok);

    while (!this.check("NEWLINE") && !this.isAtEnd()) {
      this.advance();
    }
    this.consumeStatementTerminator();

    return {
      kind: "call_screen",
      screenName: screenName.replace(/^["']|["']$/g, "").trim(),
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
    this.match("COLON");
    this.consumeStatementTerminator();

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

      this.match("COLON");
      this.consumeStatementTerminator();

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

  private parseMatchStatement(): MatchStatementAst {
    const matchTok = this.consume("IDENTIFIER", "Expected 'match'");
    const startPos = this.toPosition(matchTok);
    const expr = this.consumeExpressionUntil("COLON");
    this.match("COLON");
    this.consumeStatementTerminator();

    const cases: CaseBranchAst[] = [];
    let endPos = this.toEndPosition(matchTok);

    if (this.match("INDENT")) {
      while (!this.check("DEDENT") && !this.isAtEnd()) {
        this.skipNewlines();
        if (this.check("DEDENT") || this.isAtEnd()) break;
        if (this.check("IDENTIFIER") && this.peek().value === "case") {
          const caseTok = this.advance();
          const caseStart = this.toPosition(caseTok);
          const rawPattern = this.consumeExpressionUntil("COLON");
          this.match("COLON");
          this.consumeStatementTerminator();

          let pattern = rawPattern;
          let guardCond: string | undefined;
          const ifIdx = rawPattern.indexOf(" if ");
          if (ifIdx !== -1) {
            pattern = rawPattern.slice(0, ifIdx).trim();
            guardCond = rawPattern.slice(ifIdx + 4).trim();
          }

          const caseBody: StatementAst[] = [];
          let caseEnd = this.toEndPosition(caseTok);
          if (this.match("INDENT")) {
            while (!this.check("DEDENT") && !this.isAtEnd()) {
              this.skipNewlines();
              if (this.check("DEDENT") || this.isAtEnd()) break;
              const stmt = this.parseStatement();
              if (stmt) {
                caseBody.push(stmt);
                caseEnd = stmt.sourceLocation.end;
              }
              this.skipNewlines();
            }
            this.match("DEDENT");
          }

          cases.push({
            pattern,
            ...(guardCond ? { condition: guardCond } : {}),
            body: caseBody,
            sourceLocation: {
              file: this.file,
              start: caseStart,
              end: caseEnd,
            },
          });
          endPos = caseEnd;
        } else {
          this.parseGenericStatement();
        }
        this.skipNewlines();
      }
      this.match("DEDENT");
    }

    return {
      kind: "match",
      expression: expr,
      cases,
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

    this.match("COLON");
    this.consumeStatementTerminator();

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
      let indentDepth = 1;
      const startOffset = this.peek().offset;
      let lastEndOffset = startOffset;
      while (indentDepth > 0 && !this.isAtEnd()) {
        if (this.check("INDENT")) {
          indentDepth++;
          const tok = this.advance();
          lastEndOffset = tok.endOffset;
        } else if (this.check("DEDENT")) {
          indentDepth--;
          if (indentDepth === 0) {
            this.advance();
            break;
          }
          const tok = this.advance();
          lastEndOffset = tok.endOffset;
        } else {
          const tok = this.advance();
          lastEndOffset = tok.endOffset;
        }
      }
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
      /(?:^|[;\n])[ \t]*([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*)(?:\s*:[^=]+)?\s*(\+=|-=|\*=|\/=|%=|=)(?!=)\s*([^;\n]+)/g;

    let match: RegExpExecArray | null;
    while ((match = mutationRegex.exec(code)) !== null) {
      const varName = match[1]!;
      let op = match[2]!;
      const rawVal = match[3]!.trim();
      const cleanVal = rawVal.replace(/#.*$/, "").trim();

      if (op === "=") {
        let innerVal = cleanVal;
        while (innerVal.startsWith("(") && innerVal.endsWith(")")) {
          innerVal = innerVal.slice(1, -1).trim();
        }
        if (innerVal.startsWith("not ") || innerVal.startsWith("not(")) {
          const afterNot = innerVal.startsWith("not ")
            ? innerVal.slice(4).trim()
            : innerVal.slice(3).trim();
          let strippedAfter = afterNot;
          while (strippedAfter.startsWith("(") && strippedAfter.endsWith(")")) {
            strippedAfter = strippedAfter.slice(1, -1).trim();
          }
          if (strippedAfter === varName) {
            op = "toggle";
          }
        }
      }

      const lit = extractLiteralTarget(cleanVal);
      const isLiteral = lit !== null;
      const finalVal = lit !== null ? lit : cleanVal;

      mutations.push({
        variableName: varName,
        operator: op,
        value: finalVal,
        isLiteral,
        rawExpression: `${varName} ${op} ${cleanVal}`,
      });
    }

    const tupleRegex =
      /^([a-zA-Z_][a-zA-Z0-9_]*(?:\s*,\s*[a-zA-Z_][a-zA-Z0-9_]*)+)\s*=\s*(.+)$/gm;
    let tMatch: RegExpExecArray | null;
    while ((tMatch = tupleRegex.exec(code)) !== null) {
      const vars = tMatch[1]!.split(",").map((v) => v.trim());
      let rhs = tMatch[2]!.trim().replace(/#.*$/, "").trim();
      if (
        (rhs.startsWith("(") && rhs.endsWith(")")) ||
        (rhs.startsWith("[") && rhs.endsWith("]"))
      ) {
        rhs = rhs.slice(1, -1).trim();
      }
      const vals = rhs.split(",").map((v) => v.trim());
      for (let i = 0; i < vars.length; i++) {
        const v = vars[i]!;
        const valStr = vals[i] ?? "";
        const lit = extractLiteralTarget(valStr);
        mutations.push({
          variableName: v,
          operator: "=",
          value: lit !== null ? lit : valStr,
          isLiteral: lit !== null,
          rawExpression: `${v} = ${valStr}`,
        });
      }
    }

    return mutations;
  }

  private extractCallsAndJumpsFromPython(
    code: string,
    pos: AstPosition,
  ): { jumps: JumpStatementAst[]; calls: CallStatementAst[] } {
    const jumps: JumpStatementAst[] = [];
    const calls: CallStatementAst[] = [];

    let inQuote: string | null = null;
    let i = 0;

    while (i < code.length) {
      const ch = code[i]!;

      if (inQuote) {
        if (ch === "\\") {
          i += 2;
          continue;
        }
        if (inQuote === '"""' || inQuote === "'''") {
          if (code.startsWith(inQuote, i)) {
            inQuote = null;
            i += 3;
            continue;
          }
        } else if (ch === inQuote) {
          inQuote = null;
          i++;
          continue;
        }
        i++;
        continue;
      }

      if (ch === "#") {
        while (i < code.length && code[i] !== "\n") {
          i++;
        }
        continue;
      }

      if (code.startsWith('"""', i)) {
        inQuote = '"""';
        i += 3;
        continue;
      }
      if (code.startsWith("'''", i)) {
        inQuote = "'''";
        i += 3;
        continue;
      }
      if (ch === '"' || ch === "'") {
        inQuote = ch;
        i++;
        continue;
      }

      // Check if renpy.jump or renpy.call begins here
      if (
        (i === 0 || /[^a-zA-Z0-9_.]/.test(code[i - 1]!)) &&
        code.startsWith("renpy.", i)
      ) {
        const afterRenpy = code.slice(i + 6);
        const funcMatch = /^(jump|jump_out_of_context|call)\s*\(/y.exec(
          afterRenpy,
        );
        if (funcMatch) {
          const funcName = funcMatch[1] === "call" ? "call" : "jump";
          const startIdx = i + 6 + funcMatch[0].length;
          let depth = 1;
          let argInQuote: string | null = null;
          let j = startIdx;

          while (j < code.length && depth > 0) {
            const c = code[j]!;
            if (argInQuote) {
              if (c === "\\") {
                j += 2;
                continue;
              }
              if (argInQuote === '"""' || argInQuote === "'''") {
                if (code.startsWith(argInQuote, j)) {
                  argInQuote = null;
                  j += 3;
                  continue;
                }
              } else if (c === argInQuote) {
                argInQuote = null;
                j++;
                continue;
              }
              j++;
              continue;
            }

            if (code.startsWith('"""', j)) {
              argInQuote = '"""';
              j += 3;
              continue;
            }
            if (code.startsWith("'''", j)) {
              argInQuote = "'''";
              j += 3;
              continue;
            }
            if (c === '"' || c === "'") {
              argInQuote = c;
              j++;
              continue;
            }
            if (c === "#") {
              while (j < code.length && code[j] !== "\n") j++;
              continue;
            }

            if (c === "(") depth++;
            else if (c === ")") {
              depth--;
              if (depth === 0) break;
            }
            j++;
          }

          const rawArgs = code.slice(startIdx, j);
          const parsed = extractPythonCallTarget(rawArgs);
          if (parsed) {
            let target = parsed.target;
            const isLocal = target.startsWith(".");
            if (isLocal && this.currentGlobalLabel) {
              target = `${this.currentGlobalLabel}${target}`;
            }

            if (funcName === "jump") {
              jumps.push({
                kind: "jump",
                target,
                isExpression: parsed.isExpression,
                isLocal,
                isPythonOrigin: true,
                sourceLocation: {
                  file: this.file,
                  start: pos,
                  end: pos,
                },
              });
            } else {
              calls.push({
                kind: "call",
                target,
                isExpression: parsed.isExpression,
                isLocal,
                isPythonOrigin: true,
                sourceLocation: {
                  file: this.file,
                  start: pos,
                  end: pos,
                },
              });
            }
          }
          i = j + 1;
          continue;
        }
      }

      i++;
    }

    return { jumps, calls };
  }

  private extractJumpsFromPython(
    code: string,
    pos: AstPosition,
  ): JumpStatementAst[] {
    return this.extractCallsAndJumpsFromPython(code, pos).jumps;
  }

  private extractCallsFromPython(
    code: string,
    pos: AstPosition,
  ): CallStatementAst[] {
    return this.extractCallsAndJumpsFromPython(code, pos).calls;
  }

  // ==========================================================================
  // Asset Cues & Pass
  // ==========================================================================

  private parseAssetCueStatement(): AssetCueStatementAst {
    const cueTok = this.advance();
    const startPos = this.toPosition(cueTok);

    let lastTok = cueTok;
    while (!this.check("NEWLINE") && !this.isAtEnd()) {
      lastTok = this.advance();
    }

    const endPos = this.toPosition(this.peek());
    this.consumeStatementTerminator();

    const cueType = cueTok.value
      .toLowerCase() as AssetCueStatementAst["cueType"];
    const raw = this.source.slice(cueTok.offset, lastTok.endOffset).trim();
    let rest = raw.slice(cueTok.value.length).trim();
    if (rest.endsWith(":")) {
      rest = rest.slice(0, -1).trim();
    }

    // Skip any indented ATL or property block that follows (e.g. scene bg bedroom:\n    alpha 0.0)
    if (this.match("INDENT")) {
      let depth = 1;
      while (depth > 0 && !this.isAtEnd()) {
        if (this.check("INDENT")) {
          depth++;
          this.advance();
        } else if (this.check("DEDENT")) {
          depth--;
          this.advance();
        } else {
          this.advance();
        }
      }
    }

    let channel: string | undefined;
    let asset = rest;

    if (cueType === "scene" || cueType === "show" || cueType === "hide") {
      asset = extractSceneAsset(raw);
    } else if (cueType === "play" || cueType === "queue") {
      const match = rest.match(/^(\S+)\s*(.*)$/s);
      if (match) {
        channel = match[1];
        let audioPart = match[2].trim();
        audioPart = audioPart.replace(
          /\s+(?:fadein|fadeout|volume|loop|noloop)\b.*$/i,
          "",
        ).trim();
        asset = audioPart.replace(/^["'](.*)["']$/, "$1").trim();
      } else {
        channel = rest;
        asset = "";
      }
    } else if (cueType === "stop") {
      channel = rest.split(/\s+/)[0] || rest;
      asset = "";
    } else if (cueType === "voice") {
      channel = "voice";
      let voicePart = rest.trim();
      voicePart = voicePart.replace(/\s+(?:fadein|fadeout|volume)\b.*$/i, "")
        .trim();
      asset = voicePart.replace(/^["'](.*)["']$/, "$1").trim();
    }

    return {
      kind: "asset_cue",
      cueType,
      channel,
      asset,
      raw,
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
    const nameTok = this.consumeIdentifierLike("Expected screen name");
    const startPos = this.toPosition(screenTok);
    const endPos = this.toEndPosition(nameTok);

    if (this.check("LPAREN")) {
      this.consumeParenthesizedBlock();
    }
    this.consume("COLON", "Expected ':' after screen");
    this.consume("NEWLINE", "Expected newline after screen");

    const actions: ScreenActionAst[] = [];
    if (this.match("INDENT")) {
      const startOffset = this.peek().offset;
      let lastEndOffset = startOffset;
      let indentDepth = 1;
      while (indentDepth > 0 && !this.isAtEnd()) {
        if (this.check("INDENT")) {
          indentDepth++;
          this.advance();
          continue;
        }
        if (this.check("DEDENT")) {
          indentDepth--;
          this.advance();
          continue;
        }
        const tok = this.advance();
        lastEndOffset = tok.endOffset;
      }
      const fullScreenBody = this.source && lastEndOffset > startOffset
        ? this.source.slice(startOffset, lastEndOffset)
        : "";
      actions.push(
        ...this.extractScreenActionsFromBody(fullScreenBody, startPos.line),
      );
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

  private extractScreenActionsFromBody(
    body: string,
    startLine: number,
  ): ScreenActionAst[] {
    const actions: ScreenActionAst[] = [];
    let currentBlockTimeout:
      | { isTimeout: boolean; durationSeconds?: number }
      | undefined;

    let i = 0;
    let currentLine = startLine;

    while (i < body.length) {
      // Find end of current line
      let nextNl = body.indexOf("\n", i);
      if (nextNl === -1) nextNl = body.length;

      const fullLine = body.slice(i, nextNl);
      const trimmedLine = fullLine.trim();

      // Check for timer directive: timer <dur>: or timer <dur> action ...
      const timerMatch = /(?:^|\s)timer\s+([0-9.]+|[a-zA-Z_][a-zA-Z0-9_]*)/i
        .exec(fullLine);
      let lineTimeout:
        | { isTimeout: boolean; durationSeconds?: number }
        | undefined;

      if (timerMatch) {
        const durVal = Number(timerMatch[1]);
        lineTimeout = {
          isTimeout: true,
          ...(!isNaN(durVal) ? { durationSeconds: durVal } : {}),
        };
        if (trimmedLine.endsWith(":")) {
          currentBlockTimeout = lineTimeout;
        }
      }

      if (trimmedLine.startsWith("#")) {
        const afterLine = body.indexOf("\n", i);
        if (afterLine === -1) break;
        i = afterLine + 1;
        currentLine++;
        continue;
      }

      // Check for action trigger outside quotes on the current line
      let triggerOffset: number | null = null;
      let triggerLength = 0;
      let lineInQuote: string | null = null;

      for (let k = 0; k < fullLine.length; k++) {
        const c = fullLine[k]!;
        if (lineInQuote) {
          if (c === "\\") {
            k++;
            continue;
          }
          if (c === lineInQuote) lineInQuote = null;
          continue;
        }
        if (c === '"' || c === "'") {
          lineInQuote = c;
          continue;
        }
        if (c === "#") {
          break; // Rest of line is comment
        }
        const rem = fullLine.slice(k);
        const m = /^(?:action|alternate|selected_action)(?:\s+|=)\s*/i.exec(
          rem,
        );
        if (m && (k === 0 || /[^a-zA-Z0-9_]/.test(fullLine[k - 1]!))) {
          triggerOffset = i + k;
          triggerLength = m[0].length;
          break;
        }
      }

      if (triggerOffset !== null && triggerOffset < nextNl) {
        const exprStart = triggerOffset + triggerLength;
        // Read full expression until matching bracket or newline at bracket depth 0
        let depth = 0;
        let inQuote: string | null = null;
        let j = exprStart;

        while (j < body.length) {
          const ch = body[j]!;

          if (inQuote) {
            if (ch === "\\") {
              j += 2;
              continue;
            }
            if (inQuote === '"""' || inQuote === "'''") {
              if (body.startsWith(inQuote, j)) {
                inQuote = null;
                j += 3;
                continue;
              }
            } else if (ch === inQuote) {
              inQuote = null;
              j++;
              continue;
            }
            j++;
            continue;
          }

          if (body.startsWith('"""', j)) {
            inQuote = '"""';
            j += 3;
            continue;
          }
          if (body.startsWith("'''", j)) {
            inQuote = "'''";
            j += 3;
            continue;
          }
          if (ch === '"' || ch === "'") {
            inQuote = ch;
            j++;
            continue;
          }

          if (ch === "#") {
            while (j < body.length && body[j] !== "\n") j++;
            continue;
          }

          if (ch === "(" || ch === "[" || ch === "{") {
            depth++;
          } else if (ch === ")" || ch === "]" || ch === "}") {
            if (depth > 0) depth--;
          } else if (ch === "\n" && depth === 0) {
            break;
          }
          j++;
        }

        const rawExpr = body.slice(exprStart, j).trim();
        const effectiveTimeout = lineTimeout || currentBlockTimeout;
        this.collectScreenActionsFromExpr(
          rawExpr,
          currentLine,
          actions,
          effectiveTimeout,
        );
        i = j;
      }

      // Move to next line
      const afterLine = body.indexOf("\n", i);
      if (afterLine === -1) break;
      i = afterLine + 1;
      currentLine++;
    }

    return actions;
  }

  private collectScreenActionsFromExpr(
    expr: string,
    lineNum: number,
    actions: ScreenActionAst[],
    timeout?: { isTimeout: boolean; durationSeconds?: number },
  ): void {
    const trimmed = expr.trim();
    if (!trimmed) return;

    // Handle list of actions: [ action1, action2, ... ] or tuple ( action1, ... )
    if (
      (trimmed.startsWith("[") && trimmed.endsWith("]")) ||
      (trimmed.startsWith("(") && trimmed.endsWith(")"))
    ) {
      const inner = trimmed.slice(1, -1);
      const items = splitTopLevelPythonArgs(inner);
      for (const item of items) {
        this.collectScreenActionsFromExpr(item, lineNum, actions, timeout);
      }
      return;
    }

    // Match ActionName(...) or ActionName
    const callMatch = /^([A-Za-z_][A-Za-z0-9_]*)(?:\s*\(([\s\S]*)\))?$/.exec(
      trimmed,
    );
    if (!callMatch) {
      const callRegex = /([A-Za-z_][A-Za-z0-9_]*)\s*\(([^()]*)\)/g;
      let match: RegExpExecArray | null;
      while ((match = callRegex.exec(trimmed)) !== null) {
        this.collectSingleScreenAction(
          match[1]!,
          match[2]!.trim(),
          lineNum,
          match.index,
          actions,
          timeout,
        );
      }
      return;
    }

    const actionName = callMatch[1]!;
    const rawArgs = (callMatch[2] ?? "").trim();
    const lowerName = actionName.toLowerCase();

    // Recursive wrappers: Confirm(prompt, yes=Action, no=Action) or If(cond, true=Action, false=Action)
    if (
      lowerName === "confirm" || lowerName === "if" ||
      lowerName === "selectedif"
    ) {
      const args = splitTopLevelPythonArgs(rawArgs);
      for (const arg of args) {
        const eqIdx = arg.indexOf("=");
        if (eqIdx > 0) {
          const kw = arg.slice(0, eqIdx).trim().toLowerCase();
          const val = arg.slice(eqIdx + 1).trim();
          if (kw === "yes" || kw === "no" || kw === "true" || kw === "false") {
            this.collectScreenActionsFromExpr(val, lineNum, actions, timeout);
          }
        } else if (lowerName === "if" && arg !== args[0]) {
          this.collectScreenActionsFromExpr(arg, lineNum, actions, timeout);
        } else if (lowerName === "confirm" && arg !== args[0]) {
          this.collectScreenActionsFromExpr(arg, lineNum, actions, timeout);
        }
      }
      return;
    }

    this.collectSingleScreenAction(
      actionName,
      rawArgs,
      lineNum,
      0,
      actions,
      timeout,
    );
  }

  private collectSingleScreenAction(
    actionName: string,
    rawArgs: string,
    lineNum: number,
    charIndex: number,
    actions: ScreenActionAst[],
    timeout?: { isTimeout: boolean; durationSeconds?: number },
  ): void {
    const lowerName = actionName.toLowerCase();
    const args = splitTopLevelPythonArgs(rawArgs);
    let target: string | undefined;
    let targetExpression: string | undefined = rawArgs || undefined;
    let isDynamic = false;

    const parsedTarget = extractPythonCallTarget(rawArgs);
    if (parsedTarget) {
      if (parsedTarget.isExpression) {
        target = undefined;
        targetExpression = parsedTarget.target;
        isDynamic = true;
      } else {
        target = parsedTarget.target;
        targetExpression = undefined;
        isDynamic = false;
      }
    }

    const actionAst: ScreenActionAst = {
      actionName,
      target,
      rawArgs,
      targetExpression,
      isDynamic,
      timeout,
      sourceLocation: {
        file: this.file,
        start: { line: lineNum, column: charIndex, offset: 0 },
        end: { line: lineNum, column: charIndex + rawArgs.length, offset: 0 },
      },
    };

    if (lowerName === "setvariable") {
      let varName: string | undefined;
      let varValue: unknown = undefined;
      for (const arg of args) {
        const eqIdx = arg.indexOf("=");
        if (eqIdx > 0) {
          const kw = arg.slice(0, eqIdx).trim().toLowerCase();
          const val = arg.slice(eqIdx + 1).trim();
          if (kw === "variable" || kw === "var") {
            varName = val.replace(/^["']|["']$/g, "");
          } else if (kw === "value" || kw === "val") {
            varValue = this.parseLiteralValue(val);
          }
        }
      }
      if (!varName && args.length >= 1) {
        varName = args[0]!.replace(/^["']|["']$/g, "").trim();
      }
      if (varValue === undefined && args.length >= 2) {
        varValue = this.parseLiteralValue(args[1]!);
      }
      actionAst.variableName = varName;
      actionAst.variableValue = varValue;
    } else if (lowerName === "togglevariable") {
      let varName: string | undefined;
      for (const arg of args) {
        const eqIdx = arg.indexOf("=");
        if (eqIdx > 0) {
          const kw = arg.slice(0, eqIdx).trim().toLowerCase();
          const val = arg.slice(eqIdx + 1).trim();
          if (kw === "variable" || kw === "var") {
            varName = val.replace(/^["']|["']$/g, "");
          }
        }
      }
      if (!varName && args.length >= 1) {
        varName = args[0]!.replace(/^["']|["']$/g, "").trim();
      }
      actionAst.variableName = varName;
    }

    actions.push(actionAst);
  }

  private parseInitStatement(): InitStatementAst {
    const initTok = this.consume("INIT", "Expected 'init'");
    const startPos = this.toPosition(initTok);
    let explicitPriority: number | undefined;

    // Check for init offset = N
    if (this.check("IDENTIFIER") && this.peek().value === "offset") {
      this.advance(); // consume "offset"
      this.consume("EQUALS", "Expected '=' after init offset");
      const offsetVal = this.consumeInteger();
      this.fileInitOffset = offsetVal;
      this.consumeStatementTerminator();
      return {
        kind: "init",
        priority: offsetVal,
        isOffsetDirective: true,
        body: [],
        sourceLocation: {
          file: this.file,
          start: startPos,
          end: this.toPosition(this.peek()),
        },
      };
    }

    if (
      this.check("NUMBER") ||
      (this.check("RAW_TEXT") &&
        (this.peek().value === "-" || this.peek().value === "+"))
    ) {
      explicitPriority = this.consumeInteger();
    }

    let isPython = false;
    let isEarly = false;
    if (
      this.check("PYTHON") ||
      (this.check("IDENTIFIER") && this.peek().value === "python")
    ) {
      this.advance();
      isPython = true;
      if (this.matchKeyword("early")) {
        isEarly = true;
      }
    }

    const priority = isEarly
      ? -50000
      : ((explicitPriority ?? 0) + this.fileInitOffset);

    if (this.check("COLON")) {
      this.advance();
    }
    this.consumeStatementTerminator();

    const body: StatementAst[] = [];
    let endPos = this.toEndPosition(initTok);

    if (this.match("INDENT")) {
      if (isPython) {
        let code = "";
        let indentDepth = 1;
        while (indentDepth > 0 && !this.isAtEnd()) {
          if (this.check("INDENT")) {
            indentDepth++;
            code += this.advance().value + " ";
          } else if (this.check("DEDENT")) {
            indentDepth--;
            if (indentDepth === 0) {
              this.advance();
              break;
            }
            code += this.advance().value + " ";
          } else {
            code += this.advance().value + " ";
          }
          if (this.check("NEWLINE")) {
            code += "\n";
            this.advance();
          }
        }
        const mutations = this.extractMutationsFromPython(code);
        const jumps = this.extractJumpsFromPython(code, startPos);
        const calls = this.extractCallsFromPython(code, startPos);
        body.push({
          kind: "python",
          code: code.trim(),
          isOneLiner: false,
          mutations,
          embeddedJumps: jumps,
          embeddedCalls: calls,
          sourceLocation: {
            file: this.file,
            start: startPos,
            end: this.toPosition(this.peek()),
          },
        });
      } else {
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
    }

    return {
      kind: "init",
      priority,
      ...(isEarly ? { isEarly: true } : {}),
      body,
      sourceLocation: {
        file: this.file,
        start: startPos,
        end: endPos,
      },
    };
  }

  private parseDefineStatement(): DefineStatementAst {
    const defTok = this.consumeIdentifierLike("Expected 'define'");
    const startPos = this.toPosition(defTok);

    let priority = this.fileInitOffset;
    if (
      this.check("NUMBER") ||
      (this.peek().value === "-" && this.peek(1).type === "NUMBER")
    ) {
      let sign = 1;
      if (this.peek().value === "-") {
        sign = -1;
        this.advance();
      }
      priority = sign * Number(this.advance().value);
    }

    let varName = this.consumeIdentifierLike("Expected variable name").value;
    while (
      this.check("DOT") ||
      this.peek().value === "."
    ) {
      this.advance();
      varName += "." +
        this.consumeIdentifierLike("Expected identifier after '.'").value;
    }

    this.consume("EQUALS", "Expected '=' after variable name");
    const rawVal = this.consumeLineAsText().trim();
    this.consumeStatementTerminator();
    const cleanVal = this.parseLiteralValue(rawVal);
    return {
      kind: "define",
      name: varName,
      value: cleanVal,
      rawExpression: rawVal,
      priority,
      sourceLocation: {
        file: this.file,
        start: startPos,
        end: this.toPosition(this.peek()),
      },
    };
  }

  private parseDefaultStatement(): DefaultStatementAst {
    const defTok = this.consumeIdentifierLike("Expected 'default'");
    const startPos = this.toPosition(defTok);

    let priority = this.fileInitOffset;
    if (
      this.check("NUMBER") ||
      (this.peek().value === "-" && this.peek(1).type === "NUMBER")
    ) {
      let sign = 1;
      if (this.peek().value === "-") {
        sign = -1;
        this.advance();
      }
      priority = sign * Number(this.advance().value);
    }

    let varName = this.consumeIdentifierLike("Expected variable name").value;
    while (
      this.check("DOT") ||
      this.peek().value === "."
    ) {
      this.advance();
      varName += "." +
        this.consumeIdentifierLike("Expected identifier after '.'").value;
    }

    this.consume("EQUALS", "Expected '=' after variable name");
    const rawVal = this.consumeLineAsText().trim();
    this.consumeStatementTerminator();
    const cleanVal = this.parseLiteralValue(rawVal);
    return {
      kind: "default",
      name: varName,
      value: cleanVal,
      rawExpression: rawVal,
      priority,
      sourceLocation: {
        file: this.file,
        start: startPos,
        end: this.toPosition(this.peek()),
      },
    };
  }

  private parseImageStatement(): ImageStatementAst {
    const imgTok = this.consumeIdentifierLike("Expected 'image'");
    const startPos = this.toPosition(imgTok);

    let name = "";
    while (
      !this.check("EQUALS") && !this.check("COLON") &&
      !this.check("NEWLINE") && !this.isAtEnd()
    ) {
      name += (name ? " " : "") + this.advance().value;
    }

    let expression = "";
    if (this.match("EQUALS")) {
      expression = this.consumeLineAsText().trim();
      this.consumeStatementTerminator();
    } else if (this.match("COLON")) {
      this.consumeStatementTerminator();
      if (this.match("INDENT")) {
        while (!this.check("DEDENT") && !this.isAtEnd()) {
          this.advance();
        }
        this.match("DEDENT");
      }
      expression = name;
    } else {
      this.consumeStatementTerminator();
    }

    return {
      kind: "image",
      name: name.trim(),
      expression: expression.replace(/^["']|["']$/g, "").trim(),
      sourceLocation: {
        file: this.file,
        start: startPos,
        end: this.toPosition(this.peek()),
      },
    };
  }

  private parseLiteralValue(val: string): unknown {
    const trimmed = val.trim();
    if (trimmed === "True") return true;
    if (trimmed === "False") return false;
    if (trimmed === "None") return null;
    if (/^-?[0-9]+(\.[0-9]+)?$/.test(trimmed)) {
      return trimmed.includes(".")
        ? parseFloat(trimmed)
        : parseInt(trimmed, 10);
    }
    if (
      (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ) {
      return trimmed.slice(1, -1);
    }
    return trimmed;
  }

  private consumeInteger(): number {
    let sign = 1;
    if (this.check("RAW_TEXT") && this.peek().value === "-") {
      this.advance();
      sign = -1;
    } else if (this.check("RAW_TEXT") && this.peek().value === "+") {
      this.advance();
    }
    const numTok = this.consume("NUMBER", "Expected number");
    return sign * parseInt(numTok.value, 10);
  }

  private parsePythonBlockStatement(): PythonBlockAst {
    const pyTok = this.check("PYTHON")
      ? this.advance()
      : this.consumeIdentifierLike("Expected 'python'");
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
      let indentDepth = 1;
      while (indentDepth > 0 && !this.isAtEnd()) {
        if (this.check("INDENT")) {
          indentDepth++;
          code += this.advance().value + " ";
        } else if (this.check("DEDENT")) {
          indentDepth--;
          if (indentDepth === 0) {
            this.advance();
            break;
          }
          code += this.advance().value + " ";
        } else {
          code += this.advance().value + " ";
        }
        if (this.check("NEWLINE")) {
          code += "\n";
          this.advance();
        }
      }
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
    let bracketDepth = 0;
    while (!this.isAtEnd()) {
      if (this.check("NEWLINE")) break;
      if (bracketDepth === 0 && this.check(terminator)) break;

      const tok = this.advance();
      if (
        tok.type === "LPAREN" || tok.type === "LBRACKET" ||
        tok.type === "LBRACE"
      ) {
        bracketDepth++;
      } else if (
        tok.type === "RPAREN" || tok.type === "RBRACKET" ||
        tok.type === "RBRACE"
      ) {
        if (bracketDepth > 0) bracketDepth--;
      }
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
    const startOffset = this.peek().offset;
    let lastEndOffset = startOffset;
    let fallback = "";
    while (!this.check("NEWLINE") && !this.isAtEnd()) {
      const tok = this.advance();
      fallback += tok.value + " ";
      lastEndOffset = tok.endOffset;
    }
    this.consumeStatementTerminator();
    if (this.source && lastEndOffset > startOffset) {
      return this.source.slice(startOffset, lastEndOffset).trim();
    }
    return fallback.trim();
  }

  private parseForStatement(): ForStatementAst {
    const forTok = this.consume("FOR", "Expected 'for'");
    const startPos = this.toPosition(forTok);

    const varName = this.consumeIdentifierLike("Expected loop variable").value;
    if (this.matchKeyword("in")) {
      // consumed
    } else {
      this.advance();
    }

    const iterable = this.consumeExpressionUntil("COLON");
    this.match("COLON");
    this.consumeStatementTerminator();

    const body: StatementAst[] = [];
    let endPos = this.toEndPosition(forTok);

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
      kind: "for",
      variable: varName,
      iterable,
      body,
      sourceLocation: {
        file: this.file,
        start: startPos,
        end: endPos,
      },
    };
  }

  private parseGenericStatement(): GenericStatementAst {
    const startTok = this.peek();
    const startPos = this.toPosition(startTok);
    let endPos = this.toEndPosition(startTok);

    const startOffset = startTok.offset;
    let lastEndOffset = startOffset;
    let rawFallback = "";

    while (!this.check("NEWLINE") && !this.isAtEnd()) {
      const t = this.advance();
      rawFallback += (rawFallback ? " " : "") + t.value;
      lastEndOffset = t.endOffset;
      endPos = this.toEndPosition(t);
    }
    this.consumeStatementTerminator();

    const raw = this.source && lastEndOffset > startOffset
      ? this.source.slice(startOffset, lastEndOffset).trim()
      : rawFallback.trim();

    return {
      kind: "generic",
      rawText: raw,
      sourceLocation: {
        file: this.file,
        start: startPos,
        end: endPos,
      },
    };
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

  private consumeIdentifierLike(errMsg: string): Token {
    const tok = this.peek();
    const disallowedTypes = new Set<TokenType>([
      "EOF",
      "NEWLINE",
      "COLON",
      "INDENT",
      "DEDENT",
      "LPAREN",
      "RPAREN",
      "COMMA",
      "EQUALS",
    ]);

    if (tok.type === "DOT" && this.peek(1).type === "IDENTIFIER") {
      const dot = this.advance();
      const id = this.advance();
      let combined = "." + id.value;
      while (this.check("DOT") && this.peek(1).type === "IDENTIFIER") {
        this.advance();
        combined += "." + this.advance().value;
      }
      return {
        ...dot,
        value: combined,
      };
    }

    if (!disallowedTypes.has(tok.type) && tok.value.length > 0) {
      const first = this.advance();
      let combined = first.value;
      while (this.check("DOT") && this.peek(1).type === "IDENTIFIER") {
        this.advance();
        combined += "." + this.advance().value;
      }
      return {
        ...first,
        value: combined,
      };
    }
    throw new Error(
      `Parse error in ${this.file} at line ${
        tok.line + 1
      }: ${errMsg}. Got '${tok.value}' (${tok.type})`,
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

export function splitTopLevelPythonArgs(argsStr: string): string[] {
  const args: string[] = [];
  let current = "";
  let depth = 0;
  let inString: string | null = null;
  let i = 0;

  while (i < argsStr.length) {
    const ch = argsStr[i]!;

    if (inString) {
      if (ch === "\\") {
        current += ch;
        if (i + 1 < argsStr.length) {
          current += argsStr[i + 1];
          i += 2;
          continue;
        }
      } else if (inString === '"""' || inString === "'''") {
        if (argsStr.startsWith(inString, i)) {
          current += inString;
          i += 3;
          inString = null;
          continue;
        }
      } else if (ch === inString) {
        current += ch;
        inString = null;
        i++;
        continue;
      }
      current += ch;
      i++;
      continue;
    }

    if (argsStr.startsWith('"""', i)) {
      inString = '"""';
      current += '"""';
      i += 3;
      continue;
    }
    if (argsStr.startsWith("'''", i)) {
      inString = "'''";
      current += "'''";
      i += 3;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = ch;
      current += ch;
      i++;
      continue;
    }

    if (ch === "#") {
      while (i < argsStr.length && argsStr[i] !== "\n") {
        i++;
      }
      continue;
    }

    if (
      ch === "\\" && i + 1 < argsStr.length &&
      (argsStr[i + 1] === "\n" || argsStr[i + 1] === "\r")
    ) {
      i++;
      if (
        argsStr[i] === "\r" && i + 1 < argsStr.length && argsStr[i + 1] === "\n"
      ) i++;
      i++;
      continue;
    }

    if (ch === "(" || ch === "[" || ch === "{") {
      depth++;
    } else if (ch === ")" || ch === "]" || ch === "}") {
      if (depth > 0) depth--;
    } else if (ch === "," && depth === 0) {
      if (current.trim()) args.push(current.trim());
      current = "";
      i++;
      continue;
    }

    current += ch;
    i++;
  }

  if (current.trim()) {
    args.push(current.trim());
  }

  return args;
}

export function extractPythonCallTarget(
  callArgs: string,
): { target: string; isExpression: boolean } | null {
  const args = splitTopLevelPythonArgs(callArgs);
  if (args.length === 0) return null;

  let targetArg: string | undefined;

  // Look for label=... or target=... keyword argument
  for (const arg of args) {
    let eqIdx = -1;
    let quoteChar: string | null = null;
    let depth = 0;
    for (let j = 0; j < arg.length; j++) {
      const c = arg[j]!;
      if (quoteChar) {
        if (c === "\\") j++;
        else if (c === quoteChar) quoteChar = null;
      } else if (c === '"' || c === "'") {
        quoteChar = c;
      } else if (c === "(" || c === "[" || c === "{") {
        depth++;
      } else if (c === ")" || c === "]" || c === "}") {
        if (depth > 0) depth--;
      } else if (c === "=" && depth === 0) {
        eqIdx = j;
        break;
      }
    }

    if (eqIdx > 0) {
      const key = arg.slice(0, eqIdx).trim().toLowerCase();
      if (key === "label" || key === "target") {
        targetArg = arg.slice(eqIdx + 1).trim();
        break;
      }
    }
  }

  // If no keyword argument, take the first positional argument (arg without top-level =)
  if (!targetArg) {
    for (const arg of args) {
      let hasEq = false;
      let quoteChar: string | null = null;
      let depth = 0;
      for (let j = 0; j < arg.length; j++) {
        const c = arg[j]!;
        if (quoteChar) {
          if (c === "\\") j++;
          else if (c === quoteChar) quoteChar = null;
        } else if (c === '"' || c === "'") {
          quoteChar = c;
        } else if (c === "(" || c === "[" || c === "{") {
          depth++;
        } else if (c === ")" || c === "]" || c === "}") {
          if (depth > 0) depth--;
        } else if (c === "=" && depth === 0) {
          hasEq = true;
          break;
        }
      }
      if (!hasEq) {
        targetArg = arg.trim();
        break;
      }
    }
  }

  if (!targetArg) return null;

  // Check if targetArg is a literal string
  const lit = extractLiteralTarget(targetArg);
  if (
    lit !== null && targetArg.trim() !== '""' && targetArg.trim() !== "''" &&
    lit.trim() !== ""
  ) {
    return {
      target: lit,
      isExpression: false,
    };
  }

  return {
    target: targetArg.trim(),
    isExpression: true,
  };
}

export function parseRenpyScript(
  source: string,
  filePath: string = "script.rpy",
  options?: { parserVariant?: string },
): RenpyScriptAst {
  const tokens = tokenizeRenpy(source);
  const parser = new RenpyParser(tokens, filePath, source, options);
  return parser.parse();
}
