/**
 * src/application/dropTraversal.ts
 *
 * Recursive scanning of directories from drop events using the FileSystem Entry API.
 */

import type { UploadedFile } from "./uploadTypes.ts";

async function readAllDirectoryEntries(
  directoryReader: FileSystemDirectoryReader,
): Promise<FileSystemEntry[]> {
  const allEntries: FileSystemEntry[] = [];

  const read = (): Promise<FileSystemEntry[]> => {
    return new Promise((resolve, reject) => {
      directoryReader.readEntries((entries) => {
        resolve(entries);
      }, reject);
    });
  };

  while (true) {
    const entries = await read();
    if (entries.length === 0) break;
    allEntries.push(...entries);
  }

  return allEntries;
}

export async function traverseFileSystemEntry(
  entry: FileSystemEntry,
  path = "",
): Promise<UploadedFile[]> {
  const files: UploadedFile[] = [];

  const traverse = async (
    item: FileSystemEntry,
    currentPath: string,
  ): Promise<void> => {
    if (item.isFile) {
      const fileEntry = item as FileSystemFileEntry;
      const file = await new Promise<File>((resolve, reject) => {
        fileEntry.file(resolve, reject);
      });
      files.push({
        name: file.name,
        size: file.size,
        webkitRelativePath: currentPath + file.name,
        text: () => file.text(),
        file,
      });
    } else if (item.isDirectory) {
      const dirEntry = item as FileSystemDirectoryEntry;
      const dirReader = dirEntry.createReader();
      const entries = await readAllDirectoryEntries(dirReader);

      const newPath = currentPath + item.name + "/";
      const promises: Promise<void>[] = [];
      for (const entry of entries) {
        promises.push(traverse(entry, newPath));
      }
      await Promise.all(promises);
    }
  };

  await traverse(entry, path);
  return files;
}

export async function traverseDataTransferItems(
  items: DataTransferItemList,
): Promise<UploadedFile[]> {
  const filePromises: Promise<UploadedFile[]>[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.kind === "file") {
      const entry = item.webkitGetAsEntry();
      if (entry) {
        filePromises.push(traverseFileSystemEntry(entry));
      }
    }
  }

  const results = await Promise.all(filePromises);
  return results.flat();
}
