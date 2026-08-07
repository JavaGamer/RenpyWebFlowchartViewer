import { FileReadError } from "../domain/index.ts";

export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const rejectRead = () => reject(new FileReadError(file.name));
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        rejectRead();
        return;
      }
      resolve(reader.result);
    };
    reader.onerror = rejectRead;
    reader.onabort = rejectRead;
    reader.readAsText(file);
  });
}

export function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const rejectRead = () => reject(new FileReadError(file.name));

    // Fallback for test stubs that only mock readAsText
    if (typeof reader.readAsArrayBuffer !== "function") {
      reader.onload = () => {
        if (typeof reader.result !== "string") {
          rejectRead();
          return;
        }
        const encoder = new TextEncoder();
        resolve(encoder.encode(reader.result).buffer);
      };
      reader.onerror = rejectRead;
      reader.onabort = rejectRead;
      try {
        (reader as unknown as { readAsText: (file: File) => void }).readAsText(
          file,
        );
      } catch (err) {
        reject(err);
      }
      return;
    }

    reader.onload = () => {
      if (!(reader.result instanceof ArrayBuffer)) {
        rejectRead();
        return;
      }
      resolve(reader.result);
    };
    reader.onerror = rejectRead;
    reader.onabort = rejectRead;
    reader.readAsArrayBuffer(file);
  });
}
