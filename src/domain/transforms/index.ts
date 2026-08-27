export {
  CHAPTER_CONTAINER_PADDING,
  CHAPTER_HEADER_HEIGHT,
  CHAPTER_SUMMARY_HEIGHT,
  CHAPTER_SUMMARY_WIDTH,
  type ClusterBoundingBox,
  computeClusterBoundingBox,
  getLabelHeight,
  getNodeCenter,
  getNodeHeight,
  NODE_HEIGHT_DECISION,
  NODE_HEIGHT_LABEL,
  NODE_HEIGHT_MENU,
  NODE_WIDTH,
  normalizeChildPosition,
  PROGRESSIVE_LAYOUT_NODE_LIMIT,
} from "./layout.ts";
export { resolveGraphIntegrity } from "./integrity.ts";

export {
  buildConditionalVisibility,
  buildVisibleEdges,
  buildVisibleNodes,
} from "./visibility.ts";

export {
  CHAPTER_NODE_PREFIX,
  type ChapterAggregates,
  computeChapterAggregates,
  extractChapterName,
  getChapterId,
  groupNodesByChapter,
  isChapterId,
  redirectEdgesForCollapsedChapters,
} from "./chapterGrouping.ts";

export { collapseLinearChains, simplifyGraph } from "./simplify.ts";
export type { GraphSimplificationOptions } from "./simplify.ts";
