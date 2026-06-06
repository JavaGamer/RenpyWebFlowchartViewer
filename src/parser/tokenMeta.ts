import { PARSER_TOKENS } from './parserTokens';
import type { TokenMetaFlags } from './pipelineTypes';

function resetMetaFlags(meta: TokenMetaFlags): TokenMetaFlags {
  meta.menuDepth = 0;
  meta.hasLabelStatement = false;
  meta.hasMenuStatement = false;
  meta.hasMenuBlock = false;
  meta.hasMenuOption = false;
  meta.hasMenuOptionBlock = false;
  meta.hasJumpStatement = false;
  meta.hasCallStatement = false;
  meta.hasPythonBlock = false;
  meta.hasScreenBlock = false;
  meta.hasSayNarrator = false;
  meta.hasSayCharacter = false;
  meta.hasSayStatement = false;
  return meta;
}

export function createEmptyTokenMeta(): TokenMetaFlags {
  return resetMetaFlags({
    menuDepth: 0,
    hasLabelStatement: false,
    hasMenuStatement: false,
    hasMenuBlock: false,
    hasMenuOption: false,
    hasMenuOptionBlock: false,
    hasJumpStatement: false,
    hasCallStatement: false,
    hasPythonBlock: false,
    hasScreenBlock: false,
    hasSayNarrator: false,
    hasSayCharacter: false,
    hasSayStatement: false,
  });
}

export function analyzeTokenMetaInto(
  metas: Iterable<number>,
  outMeta: TokenMetaFlags,
): TokenMetaFlags {
  const meta = resetMetaFlags(outMeta);

  for (const m of metas) {
    if (PARSER_TOKENS.metaPythonBlock !== undefined && m === PARSER_TOKENS.metaPythonBlock) {
      meta.hasPythonBlock = true;
      continue;
    }
    if (PARSER_TOKENS.metaScreenBlock !== undefined && m === PARSER_TOKENS.metaScreenBlock) {
      meta.hasScreenBlock = true;
      continue;
    }
    switch (m) {
      case PARSER_TOKENS.metaMenuStatement:
        meta.menuDepth += 1;
        meta.hasMenuStatement = true;
        break;
      case PARSER_TOKENS.metaLabelStatement:
        meta.hasLabelStatement = true;
        break;
      case PARSER_TOKENS.metaMenuBlock:
        meta.hasMenuBlock = true;
        break;
      case PARSER_TOKENS.metaMenuOption:
        meta.hasMenuOption = true;
        break;
      case PARSER_TOKENS.metaMenuOptionBlock:
        meta.hasMenuOptionBlock = true;
        break;
      case PARSER_TOKENS.metaJumpStatement:
        meta.hasJumpStatement = true;
        break;
      case PARSER_TOKENS.metaCallStatement:
        meta.hasCallStatement = true;
        break;
      case PARSER_TOKENS.metaSayNarrator:
        meta.hasSayNarrator = true;
        break;
      case PARSER_TOKENS.metaSayCharacter:
        meta.hasSayCharacter = true;
        break;
      case PARSER_TOKENS.metaSayStatement:
        meta.hasSayStatement = true;
        break;
      default:
        break;
    }
  }

  return meta;
}

export function analyzeTokenMeta(metas: Iterable<number>): TokenMetaFlags {
  return analyzeTokenMetaInto(metas, createEmptyTokenMeta());
}
