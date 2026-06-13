import { describe, expect, it } from 'vitest';
import { stripPythonComments } from '../src/parser/initMapper';
import { parseDictLiteral, extractLiteralTarget } from '../src/parser/tokenHandling';

describe('stripPythonComments escape handling', () => {
  it('strips plain comments', () => {
    expect(stripPythonComments('x = 5 # some comment')).toBe('x = 5 ');
  });

  it('keeps # inside double quotes', () => {
    expect(stripPythonComments('x = "hello # world" # comment')).toBe('x = "hello # world" ');
  });

  it('keeps # inside single quotes', () => {
    expect(stripPythonComments("x = 'hello # world' # comment")).toBe("x = 'hello # world' ");
  });

  it('handles escaped double quotes in double quotes', () => {
    expect(stripPythonComments('x = "hello \\"escaped\\" world" # comment')).toBe('x = "hello \\"escaped\\" world" ');
  });

  it('handles escaped single quotes in single quotes', () => {
    expect(stripPythonComments("x = 'hello \\'escaped\\' world' # comment")).toBe("x = 'hello \\'escaped\\' world' ");
  });

  it('handles backslashes that do not escape quotes', () => {
    expect(stripPythonComments('x = "hello\\\\world" # comment')).toBe('x = "hello\\\\world" ');
  });
});

describe('parseDictLiteral robust parsing', () => {
  it('parses basic dictionary', () => {
    const result = parseDictLiteral('{"key": "value", "key2": "value2"}');
    expect(result).not.toBeNull();
    expect(result!.get('key')).toBe('value');
    expect(result!.get('key2')).toBe('value2');
  });

  it('parses dictionary with spaces', () => {
    const result = parseDictLiteral('  {  "key"  :  "value"  ,  "key2"  :  "value2"  }  ');
    expect(result).not.toBeNull();
    expect(result!.get('key')).toBe('value');
    expect(result!.get('key2')).toBe('value2');
  });

  it('parses single quotes', () => {
    const result = parseDictLiteral("{'key': 'value'}");
    expect(result).not.toBeNull();
    expect(result!.get('key')).toBe('value');
  });

  it('parses empty strings', () => {
    const result = parseDictLiteral('{"": ""}');
    expect(result).not.toBeNull();
    expect(result!.get('')).toBe('');
  });

  it('parses escaped quotes inside keys and values', () => {
    const result = parseDictLiteral('{"key\\"name": "val\\\'ue"}');
    expect(result).not.toBeNull();
    expect(result!.get('key"name')).toBe("val'ue");
  });

  it('returns null on invalid format', () => {
    expect(parseDictLiteral('{"key" "value"}')).toBeNull();
    expect(parseDictLiteral('{"key": }')).toBeNull();
    expect(parseDictLiteral('not a dict')).toBeNull();
  });
});

describe('extractLiteralTarget robust parsing', () => {
  it('extracts plain double quoted string', () => {
    expect(extractLiteralTarget('"hello"')).toBe('hello');
  });

  it('extracts plain single quoted string', () => {
    expect(extractLiteralTarget("'hello'")).toBe('hello');
  });

  it('extracts triple quoted strings', () => {
    expect(extractLiteralTarget('"""hello"""')).toBe('hello');
    expect(extractLiteralTarget("'''hello'''")).toBe('hello');
  });

  it('supports python prefix notations', () => {
    expect(extractLiteralTarget('r"hello"')).toBe('hello');
    expect(extractLiteralTarget('u"hello"')).toBe('hello');
    expect(extractLiteralTarget('ur"hello"')).toBe('hello');
  });

  it('correctly handles escapes in non-raw strings', () => {
    expect(extractLiteralTarget('"hello \\"world\\""')).toBe('hello "world"');
    expect(extractLiteralTarget('"hello \\n world"')).toBe('hello \n world');
  });

  it('does not unescape inside raw strings', () => {
    expect(extractLiteralTarget('r"hello \\"world\\""')).toBe('hello \\"world\\"');
  });

  it('returns null for empty or non-quoted inputs', () => {
    expect(extractLiteralTarget('""')).toBeNull();
    expect(extractLiteralTarget('   ')).toBeNull();
    expect(extractLiteralTarget('identifier')).toBeNull();
  });
});
