export interface PythonAssignment {
  variable: string;
  operator?:
    | "="
    | "+="
    | "-="
    | "*="
    | "/="
    | "%="
    | "//="
    | "**="
    | "toggle";
  typeAnnotation?: string;
  valueExpression?: string;
  valueLiteral?: string;
  valueDict?: Map<string, string>;
  valueList?: string[];
  startIndex: number;
}

export interface PythonDirectCall {
  functionName: "jump" | "call";
  targetExpression: string;
  startIndex: number;
  endIndex: number;
}

export interface PythonParsedBlock {
  assignments: PythonAssignment[];
  directCalls: PythonDirectCall[];
}

export interface PythonAstEvaluationResult {
  value: unknown;
  isStaticallyEvaluated: boolean;
  stringCandidates: string[];
}
