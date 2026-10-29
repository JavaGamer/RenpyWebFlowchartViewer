/**
 * src/parser/ast/lexer.ts
 *
 * Indentation-aware lexer for Ren'Py scripts.
 * Correctly tracks INDENT / DEDENT / NEWLINE, trivia (comments and blank lines),
 * bracket nesting, and string literals.
 */

import type { Token, TokenType } from "./types.ts";

const KEYWORDS: Record<string, TokenType> = {
  label: "LABEL",
  menu: "MENU",
  jump: "JUMP",
  call: "CALL",
  return: "RETURN",
  if: "IF",
  elif: "ELIF",
  else: "ELSE",
  while: "WHILE",
  screen: "SCREEN",
  init: "INIT",
  python: "PYTHON",
  pass: "PASS",
  scene: "SCENE",
  show: "SHOW",
  hide: "HIDE",
  play: "PLAY",
  stop: "STOP",
  queue: "QUEUE",
  voice: "VOICE",
};

export class RenpyLexer {
  private source: string;
  private length: number;
  private pos: number = 0;
  private line: number = 0;
  private col: number = 0;

  private indentStack: number[] = [0];
  private bracketDepth: number = 0;
  private tokens: Token[] = [];
  private atLineStart: boolean = true;

  constructor(source: string) {
    this.source = source;
    this.length = source.length;
  }

  public tokenize(): Token[] {
    this.tokens = [];
    this.pos = 0;
    this.line = 0;
    this.col = 0;
    this.indentStack = [0];
    this.bracketDepth = 0;
    this.atLineStart = true;

    while (this.pos < this.length) {
      if (this.atLineStart) {
        this.handleLineStart();
        if (this.pos >= this.length) break;
        if (this.atLineStart) continue;
      }

      const ch = this.source[this.pos]!;

      // Handle comments outside of strings
      if (ch === "#") {
        this.skipComment();
        continue;
      }

      // Handle whitespace on the line
      if (ch === " " || ch === "\t" || ch === "\r") {
        this.advance();
        continue;
      }

      // Handle explicit line continuation with backslash '\'
      if (ch === "\\" && this.peek() === "\n") {
        this.advance(); // consume '\'
        this.advance(); // consume '\n'
        this.line++;
        this.col = 0;
        continue;
      }
      if (ch === "\\" && this.peek() === "\r" && this.peek(2) === "\n") {
        this.advance(); // consume '\'
        this.advance(); // consume '\r'
        this.advance(); // consume '\n'
        this.line++;
        this.col = 0;
        continue;
      }

      // Handle newlines
      if (ch === "\n") {
        this.handleNewline();
        continue;
      }

      // Handle one-line python statement starting with '$'
      if (ch === "$") {
        const startOffset = this.pos;
        const startCol = this.col;
        const startLine = this.line;
        this.advance(); // consume '$'
        this.tokens.push({
          type: "DOLLAR",
          value: "$",
          line: startLine,
          column: startCol,
          offset: startOffset,
          endOffset: this.pos,
        });

        // The rest of the line until newline/comment is the python expression
        this.consumeOneLinePython();
        continue;
      }

      // Strings (triple quotes or single/double quotes)
      if (ch === '"' || ch === "'") {
        this.consumeString();
        continue;
      }

      // Identifiers / Keywords
      if (this.isIdentifierStart(ch)) {
        this.consumeIdentifierOrKeyword();
        continue;
      }

      // Numbers
      if (this.isDigit(ch)) {
        this.consumeNumber();
        continue;
      }

      // Symbols and Brackets
      this.consumeSymbol(ch);
    }

    // Clean up remaining newlines / dedents at end of file
    if (
      this.tokens.length > 0 &&
      this.tokens[this.tokens.length - 1]!.type !== "NEWLINE"
    ) {
      this.tokens.push({
        type: "NEWLINE",
        value: "\n",
        line: this.line,
        column: this.col,
        offset: this.pos,
        endOffset: this.pos,
      });
    }

    while (this.indentStack.length > 1) {
      this.indentStack.pop();
      this.tokens.push({
        type: "DEDENT",
        value: "",
        line: this.line,
        column: this.col,
        offset: this.pos,
        endOffset: this.pos,
      });
    }

    this.tokens.push({
      type: "EOF",
      value: "",
      line: this.line,
      column: this.col,
      offset: this.pos,
      endOffset: this.pos,
    });

    return this.tokens;
  }

  private handleLineStart(): void {
    let currentIndent = 0;
    const startPos = this.pos;

    while (this.pos < this.length) {
      const c = this.source[this.pos]!;
      if (c === " ") {
        currentIndent += 1;
        this.pos++;
        this.col++;
      } else if (c === "\t") {
        // Tab standardized to 8 spaces
        currentIndent += 8 - (currentIndent % 8);
        this.pos++;
        this.col++;
      } else {
        break;
      }
    }

    // Check if line is empty or purely a comment
    const nextChar = this.source[this.pos];
    if (
      this.pos >= this.length ||
      nextChar === "\n" ||
      nextChar === "\r" ||
      nextChar === "#"
    ) {
      // Blank or comment line: trivia, do not emit INDENT/DEDENT
      if (nextChar === "#") {
        this.skipComment();
      }
      if (this.source[this.pos] === "\r") this.advance();
      if (this.source[this.pos] === "\n") {
        this.advance();
        this.line++;
        this.col = 0;
      }
      this.atLineStart = true;
      return;
    }

    // Line has content. Compare currentIndent with indentStack top
    // Only check indentation if not nested inside parentheses/brackets
    if (this.bracketDepth === 0) {
      const currentLevel = this.indentStack[this.indentStack.length - 1]!;
      if (currentIndent > currentLevel) {
        this.indentStack.push(currentIndent);
        this.tokens.push({
          type: "INDENT",
          value: " ".repeat(currentIndent - currentLevel),
          line: this.line,
          column: 0,
          offset: startPos,
          endOffset: this.pos,
        });
      } else if (currentIndent < currentLevel) {
        while (
          this.indentStack.length > 1 &&
          this.indentStack[this.indentStack.length - 1]! > currentIndent
        ) {
          this.indentStack.pop();
          this.tokens.push({
            type: "DEDENT",
            value: "",
            line: this.line,
            column: currentIndent,
            offset: startPos,
            endOffset: this.pos,
          });
        }
      }
    }

    this.atLineStart = false;
  }

  private handleNewline(): void {
    const startOffset = this.pos;
    const startCol = this.col;
    const startLine = this.line;
    this.advance();
    this.line++;
    this.col = 0;

    if (this.bracketDepth === 0) {
      // Avoid emitting consecutive NEWLINE tokens
      if (
        this.tokens.length > 0 &&
        this.tokens[this.tokens.length - 1]!.type !== "NEWLINE" &&
        this.tokens[this.tokens.length - 1]!.type !== "INDENT"
      ) {
        this.tokens.push({
          type: "NEWLINE",
          value: "\n",
          line: startLine,
          column: startCol,
          offset: startOffset,
          endOffset: this.pos,
        });
      }
      this.atLineStart = true;
    }
  }

  private skipComment(): void {
    while (
      this.pos < this.length &&
      this.source[this.pos] !== "\n" &&
      this.source[this.pos] !== "\r"
    ) {
      this.advance();
    }
  }

  private consumeOneLinePython(): void {
    let text = "";
    const startOffset = this.pos;
    const startCol = this.col;
    const startLine = this.line;

    let inString: string | null = null;
    while (this.pos < this.length) {
      const c = this.source[this.pos]!;
      if (inString) {
        if (c === "\\") {
          text += c;
          this.advance();
          if (this.pos < this.length) {
            text += this.source[this.pos];
            this.advance();
          }
          continue;
        }
        if (c === inString) {
          inString = null;
        }
        text += c;
        this.advance();
      } else {
        if (c === '"' || c === "'") {
          inString = c;
          text += c;
          this.advance();
        } else if (c === "#") {
          this.skipComment();
          break;
        } else if (c === "\n" || c === "\r") {
          break;
        } else {
          text += c;
          this.advance();
        }
      }
    }

    const trimmed = text.trim();
    if (trimmed.length > 0) {
      this.tokens.push({
        type: "RAW_TEXT",
        value: trimmed,
        line: startLine,
        column: startCol,
        offset: startOffset,
        endOffset: this.pos,
      });
    }
  }

  private consumeString(): void {
    const quote = this.source[this.pos]!;
    const startOffset = this.pos;
    const startCol = this.col;
    const startLine = this.line;

    const isTriple = this.peek() === quote && this.peek(2) === quote;
    if (isTriple) {
      this.advance(); // 1
      this.advance(); // 2
      this.advance(); // 3
    } else {
      this.advance();
    }

    let val = "";
    while (this.pos < this.length) {
      const c = this.source[this.pos]!;
      if (c === "\\") {
        this.advance();
        if (this.pos < this.length) {
          val += this.source[this.pos];
          this.advance();
        }
        continue;
      }

      if (isTriple) {
        if (c === quote && this.peek() === quote && this.peek(2) === quote) {
          this.advance();
          this.advance();
          this.advance();
          break;
        }
      } else {
        if (c === quote) {
          this.advance();
          break;
        }
        if (c === "\n") {
          // Unclosed single-line string, break to avoid eating file
          break;
        }
      }

      if (c === "\n") {
        this.line++;
        this.col = 0;
      }
      val += c;
      this.advance();
    }

    this.tokens.push({
      type: "STRING",
      value: val,
      line: startLine,
      column: startCol,
      offset: startOffset,
      endOffset: this.pos,
    });
  }

  private consumeIdentifierOrKeyword(): void {
    const startOffset = this.pos;
    const startCol = this.col;
    const startLine = this.line;
    let name = "";

    // Support leading dot for local labels, e.g. .sublabel
    if (this.source[this.pos] === ".") {
      name += ".";
      this.advance();
    }

    while (
      this.pos < this.length && this.isIdentifierPart(this.source[this.pos]!)
    ) {
      name += this.source[this.pos];
      this.advance();
    }

    const keywordType = KEYWORDS[name];
    if (keywordType) {
      this.tokens.push({
        type: keywordType,
        value: name,
        line: startLine,
        column: startCol,
        offset: startOffset,
        endOffset: this.pos,
      });
    } else {
      this.tokens.push({
        type: "IDENTIFIER",
        value: name,
        line: startLine,
        column: startCol,
        offset: startOffset,
        endOffset: this.pos,
      });
    }
  }

  private consumeNumber(): void {
    const startOffset = this.pos;
    const startCol = this.col;
    const startLine = this.line;
    let numStr = "";

    while (
      this.pos < this.length &&
      (this.isDigit(this.source[this.pos]!) || this.source[this.pos] === ".")
    ) {
      numStr += this.source[this.pos];
      this.advance();
    }

    this.tokens.push({
      type: "NUMBER",
      value: numStr,
      line: startLine,
      column: startCol,
      offset: startOffset,
      endOffset: this.pos,
    });
  }

  private consumeSymbol(ch: string): void {
    const startOffset = this.pos;
    const startCol = this.col;
    const startLine = this.line;

    if (ch === "=" && this.peek() === "=") {
      this.advance();
      this.advance();
      this.tokens.push({
        type: "EQUALS",
        value: "==",
        line: startLine,
        column: startCol,
        offset: startOffset,
        endOffset: this.pos,
      });
      return;
    }

    if (
      (ch === "!" || ch === "<" || ch === ">" || ch === "+" || ch === "-" ||
        ch === "*" || ch === "/") &&
      this.peek() === "="
    ) {
      const val = ch + "=";
      this.advance();
      this.advance();
      this.tokens.push({
        type: "RAW_TEXT",
        value: val,
        line: startLine,
        column: startCol,
        offset: startOffset,
        endOffset: this.pos,
      });
      return;
    }

    let type: TokenType;
    switch (ch) {
      case ":":
        type = "COLON";
        break;
      case "(":
        type = "LPAREN";
        this.bracketDepth++;
        break;
      case ")":
        type = "RPAREN";
        if (this.bracketDepth > 0) this.bracketDepth--;
        break;
      case "[":
        type = "LBRACKET";
        this.bracketDepth++;
        break;
      case "]":
        type = "RBRACKET";
        if (this.bracketDepth > 0) this.bracketDepth--;
        break;
      case ",":
        type = "COMMA";
        break;
      case ".":
        type = "DOT";
        break;
      case "=":
        type = "EQUALS";
        break;
      default:
        type = "RAW_TEXT";
        break;
    }

    this.advance();
    this.tokens.push({
      type,
      value: ch,
      line: startLine,
      column: startCol,
      offset: startOffset,
      endOffset: this.pos,
    });
  }

  private advance(): void {
    this.pos++;
    this.col++;
  }

  private peek(offset: number = 1): string {
    const idx = this.pos + offset;
    return idx < this.length ? this.source[idx]! : "";
  }

  private isIdentifierStart(ch: string): boolean {
    return (
      (ch >= "a" && ch <= "z") ||
      (ch >= "A" && ch <= "Z") ||
      ch === "_" ||
      ch === "."
    );
  }

  private isIdentifierPart(ch: string): boolean {
    return (
      (ch >= "a" && ch <= "z") ||
      (ch >= "A" && ch <= "Z") ||
      (ch >= "0" && ch <= "9") ||
      ch === "_" ||
      ch === "."
    );
  }

  private isDigit(ch: string): boolean {
    return ch >= "0" && ch <= "9";
  }
}

export function tokenizeRenpy(source: string): Token[] {
  const lexer = new RenpyLexer(source);
  return lexer.tokenize();
}
