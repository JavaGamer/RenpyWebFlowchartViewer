import Papa from 'papaparse';
import type { FlowNode } from '../../domain/index.ts';

export interface CsvDialogueRow {
  'Node ID': string;
  'Chapter/File Path': string;
  'Line Number': string;
  'Speaker/Character Name': string;
  'Dialogue Text': string;
  'Word Count': number;
  'Node Type': string;
}

function calculateWordCount(text: string): number {
  if (!text) return 0;
  // Strip Ren'Py text formatting tags like {w=1.0}, {color=...}, {b}, {/b}
  const cleanText = text.replace(/\{[^}]*\}/g, '').trim();
  if (!cleanText) return 0;
  // Count CJK (Chinese, Japanese, Korean) characters individually
  const cjkMatches = cleanText.match(/[\u3000-\u9fff\uac00-\ud7af]/g) || [];
  // Count space-delimited words for non-CJK text
  const spaceDelimitedWords = cleanText.replace(/[\u3000-\u9fff\uac00-\ud7af]/g, ' ').match(/\S+/g) || [];
  return cjkMatches.length + spaceDelimitedWords.length;
}

/**
 * Converts a list of flow nodes into a CSV dialogue payload using PapaParse.
 * Includes complete script details for localization and voice acting workflows.
 */
export function generateDialogueCsv(nodes: FlowNode[]): string {
  if (!Array.isArray(nodes) || nodes.length === 0) {
    return '';
  }

  const rows: CsvDialogueRow[] = [];

  for (const node of nodes) {
    if (!node) continue;
    const chapter = node.chapter || 'game/script.rpy';

    if (Array.isArray(node.dialogueLines) && node.dialogueLines.length > 0) {
      node.dialogueLines.forEach((item: unknown, index: number) => {
        let speaker = 'Dialogue';
        let text: string;
        let lineNum: string | number = node.dialogueLineNums?.[index] ?? (index + 1);

        if (typeof item === 'string') {
          text = item;
        } else if (item && typeof item === 'object') {
          const obj = item as Record<string, unknown>;
          if (typeof obj.speaker === 'string') speaker = obj.speaker;
          if (typeof obj.text === 'string') text = obj.text;
          else text = String(obj.text || '');
          if (typeof obj.lineNumber === 'number' || typeof obj.lineNumber === 'string') {
            lineNum = obj.lineNumber;
          }
        } else {
          text = String(item || '');
        }

        const wordCount = calculateWordCount(text);

        rows.push({
          'Node ID': node.id ?? 'unnamed',
          'Chapter/File Path': chapter,
          'Line Number': String(lineNum),
          'Speaker/Character Name': speaker,
          'Dialogue Text': text,
          'Word Count': wordCount,
          'Node Type': node.type ?? 'LABEL',
        });
      });
    } else {
      // Include node structural row if no dialogue lines exist
      rows.push({
        'Node ID': node.id ?? 'unnamed',
        'Chapter/File Path': chapter,
        'Line Number': '1',
        'Speaker/Character Name': 'N/A',
        'Dialogue Text': `[${node.type ?? 'LABEL'}: ${node.label || 'unnamed'}]`,
        'Word Count': node.wordCount || 0,
        'Node Type': node.type ?? 'LABEL',
      });
    }
  }

  return Papa.unparse(rows, {
    header: true,
    quotes: true,
    skipEmptyLines: true,
  });
}
