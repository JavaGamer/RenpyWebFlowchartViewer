export class BaseDomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BaseDomainError";
  }
}

export class FileReadError extends BaseDomainError {
  constructor(filename: string) {
    super(
      `Could not read "${filename}". The file may be inaccessible or corrupted.`,
    );
    this.name = "FileReadError";
  }
}

export class UploadValidationError extends BaseDomainError {
  constructor(message: string) {
    super(message);
    this.name = "UploadValidationError";
  }
}

export class ParseError extends BaseDomainError {
  constructor(message: string) {
    super(message);
    this.name = "ParseError";
  }
}

export class LayoutError extends BaseDomainError {
  constructor(message: string) {
    super(message);
    this.name = "LayoutError";
  }
}
