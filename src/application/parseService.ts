import { parseRenpyFilesInWorker, type ParseWorkerRequest, type ParseWorkerResult } from '../infrastructure';

export type ParseServiceRequest = ParseWorkerRequest;
export type ParseServiceResult = ParseWorkerResult;

export interface ParseService {
  parse(request: ParseServiceRequest): Promise<ParseServiceResult>;
}

export const workerParseService: ParseService = {
  parse(request) {
    return parseRenpyFilesInWorker(request);
  },
};
