import type { SourceLocation } from "./graph.ts";

export type EndingType =
  | "good"
  | "bad"
  | "true"
  | "normal"
  | "dead_end"
  | "custom";

export interface EndingSummary {
  nodeId: string;
  label: string;
  chapter?: string;
  endingType: EndingType;
  isTerminalOutcome: boolean;
  isOrphan: boolean;
  wordCount: number;
  pauseDuration: number;
  dialogueCount: number;
  totalReachableRoutes: number;
  sourceLocation?: SourceLocation;
}

export interface RouteChoiceStep {
  menuNodeId: string;
  menuLabel: string;
  edgeId: string;
  choiceText?: string;
  targetNodeId: string;
  targetNodeLabel: string;
  conditionExpression?: string;
}

export interface StoryRoute {
  routeId: string;
  terminalEnding: EndingSummary;
  nodeIds: string[];
  edgeIds: string[];
  choices: RouteChoiceStep[];
  wordCount: number;
  pauseDuration: number;
  dialogueCount: number;
  readingTimeSeconds: number;
  formattedReadingTime: string;
  chaptersTraversed: string[];
  hasCycle: boolean;
}

export interface PointOfNoReturn {
  edgeId: string;
  sourceNodeId: string;
  sourceNodeLabel: string;
  targetNodeId: string;
  targetNodeLabel: string;
  choiceText?: string;
  conditionExpression?: string;
  isEndingLockIn: boolean; // true when remaining reachable endings count == 1
  priorReachableEndingIds: string[];
  remainingReachableEndingIds: string[];
  eliminatedEndingIds: string[];
}

export interface MonologueSection {
  id: string;
  chapter: string;
  startNodeId: string;
  startNodeLabel: string;
  endNodeId: string;
  endNodeLabel: string;
  nodeCount: number;
  dialogueLineCount: number;
  wordCount: number;
  readingTimeSeconds: number;
  formattedReadingTime: string;
  sourceLocations: SourceLocation[];
}

export interface ChapterPacingStats {
  chapter: string;
  totalDialogueLines: number;
  totalWordCount: number;
  totalMenus: number;
  totalChoices: number;
  dialogueToChoiceRatio: number;
  readingTimeSeconds: number;
  formattedReadingTime: string;
  monologueSections: MonologueSection[];
  longestMonologueLines: number;
  longestMonologueWords: number;
}

export interface CharacterPacingStats {
  speaker: string;
  lineCount: number;
  wordCount: number;
  percentageOfLines: number;
  percentageOfWords: number;
}

export interface ProjectNarrativeReport {
  totalEndings: number;
  reachableEndings: EndingSummary[];
  unreachableEndings: EndingSummary[];
  totalRoutes: number;
  routes: StoryRoute[];
  shortestRoute: StoryRoute | null;
  longestRoute: StoryRoute | null;
  averageReadingTimeSeconds: number;
  formattedAverageReadingTime: string;
  totalUniqueStoryWords: number;
  totalUniqueReadingTimeSeconds: number;
  formattedTotalUniqueReadingTime: string;
  globalDialogueToChoiceRatio: number;
  globalBranchingFactor: number;
  pointsOfNoReturn: PointOfNoReturn[];
  chapterPacing: Record<string, ChapterPacingStats>;
  characterStats: CharacterPacingStats[];
  isTruncated: boolean; // true if route enumeration reached gas limit
}

export interface HighlightedRoute {
  routeId: string;
  name: string;
  endingLabel: string;
  nodeIds: string[];
  edgeIds: string[];
  stepOrderMap: Record<string, number>;
  totalWords: number;
  formattedReadingTime: string;
}
