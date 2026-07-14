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
