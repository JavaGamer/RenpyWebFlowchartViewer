import { parseRenpyFilesInWorker, type ParseWorkerClientRequest, type ParseWorkerClientResult } from '../infrastructure';

export type ParseServiceRequest = ParseWorkerClientRequest;
export type ParseServiceResult = ParseWorkerClientResult;

export interface ParseService {
  parse(request: ParseServiceRequest): Promise<ParseServiceResult>;
}

export const workerParseService: ParseService = {
  parse(request) {
    return parseRenpyFilesInWorker(request);
  },
};
