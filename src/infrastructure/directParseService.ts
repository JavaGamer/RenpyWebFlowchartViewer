import type {
  DialogueSearchResult,
  NodeDetailsPayload,
} from "../domain/index.ts";
import {
  HeadlessParserEngine,
  type ParserSessionState,
} from "../parser/index.ts";
import type {
  ParseService,
  ParseServiceRequest,
  ParseServiceResult,
} from "./workerProtocol.ts";

export type DirectParseSessionState = ParserSessionState;

export class DirectParseService implements ParseService {
  private engine: HeadlessParserEngine;

  constructor(engine?: HeadlessParserEngine) {
    this.engine = engine ?? new HeadlessParserEngine();
  }

  public getSession(sessionId = "default"): DirectParseSessionState {
    return this.engine.getSession(sessionId);
  }

  public clearSession(sessionId?: string): void {
    this.engine.clearSession(sessionId);
  }

  public pruneOldSessions(activeSessionId: string): void {
    this.engine.pruneOldSessions(activeSessionId);
  }

  public parse(request: ParseServiceRequest): Promise<ParseServiceResult> {
    return this.engine.parse(request) as Promise<ParseServiceResult>;
  }

  public searchDialogueLines(request: {
    query: string;
    sessionId?: string;
    nodeIds?: string[];
    maxResults?: number;
    signal?: AbortSignal;
  }): Promise<DialogueSearchResult[]> {
    return this.engine.searchDialogueLines(request);
  }

  public extractNodeDetails(
    nodeIds: string[],
    sessionId = "default",
    signal?: AbortSignal,
  ): Promise<Record<string, NodeDetailsPayload>> {
    return this.engine.extractNodeDetails(nodeIds, sessionId, signal);
  }
}

export const directParseService = new DirectParseService();
