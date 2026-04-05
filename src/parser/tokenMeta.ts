import { PARSER_TOKENS } from '../parserTokens';
import type { TokenMetaFlags } from './pipelineTypes';

export function analyzeTokenMeta(metas: Iterable<number>): TokenMetaFlags {
  let menuDepth = 0;
  let hasLabelStatement = false;
  let hasMenuStatement = false;
  let hasMenuBlock = false;
  let hasMenuOption = false;
  let hasMenuOptionBlock = false;
  let hasJumpStatement = false;
  let hasCallStatement = false;
  let hasSayNarrator = false;
  let hasSayCharacter = false;
  let hasSayStatement = false;

  for (const m of metas) {
    if (m === PARSER_TOKENS.metaMenuStatement) {
      menuDepth += 1;
      hasMenuStatement = true;
      continue;
    }
    if (m === PARSER_TOKENS.metaLabelStatement) {
      hasLabelStatement = true;
      continue;
    }
    if (m === PARSER_TOKENS.metaMenuBlock) {
      hasMenuBlock = true;
      continue;
    }
    if (m === PARSER_TOKENS.metaMenuOption) {
      hasMenuOption = true;
      continue;
    }
    if (m === PARSER_TOKENS.metaMenuOptionBlock) {
      hasMenuOptionBlock = true;
      continue;
    }
    if (m === PARSER_TOKENS.metaJumpStatement) {
      hasJumpStatement = true;
      continue;
    }
    if (m === PARSER_TOKENS.metaCallStatement) {
      hasCallStatement = true;
      continue;
    }
    if (m === PARSER_TOKENS.metaSayNarrator) {
      hasSayNarrator = true;
      continue;
    }
    if (m === PARSER_TOKENS.metaSayCharacter) {
      hasSayCharacter = true;
      continue;
    }
    if (m === PARSER_TOKENS.metaSayStatement) {
      hasSayStatement = true;
    }
  }

  return {
    menuDepth,
    hasLabelStatement,
    hasMenuStatement,
    hasMenuBlock,
    hasMenuOption,
    hasMenuOptionBlock,
    hasJumpStatement,
    hasCallStatement,
    hasSayNarrator,
    hasSayCharacter,
    hasSayStatement,
  };
}
