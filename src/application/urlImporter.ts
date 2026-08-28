/**
 * src/application/urlImporter.ts
 *
 * Implements remote fetching of Ren'Py scripts or ZIP archives from URLs,
 * with automatic GitHub repository resolution.
 */

import { extractRpyFilesFromZip } from "./zipExtractor.ts";
import type { UploadedFile } from "./uploadTypes.ts";

/**
 * Automatically converts a standard GitHub repository page URL into its main branch ZIP archive download link.
 * E.g., https://github.com/owner/repo -> https://github.com/owner/repo/archive/refs/heads/main.zip
 */
/**
 * Automatically converts a standard GitHub repository page URL into its main branch ZIP archive download link.
 * E.g., https://github.com/owner/repo -> https://github.com/owner/repo/archive/refs/heads/main.zip
 */
export function resolveGithubUrl(urlStr: string): string {
  const cleanUrl = urlStr.trim();
  try {
    const parsed = new URL(cleanUrl);
    if (
      parsed.hostname === "github.com" ||
      parsed.hostname === "www.github.com"
    ) {
      const parts = parsed.pathname.split("/").filter(Boolean);
      if (parts.length === 2) {
        const [owner, repo] = parts;
        return `https://github.com/${owner}/${
          repo.replace(/\.git$/i, "")
        }/archive/refs/heads/main.zip`;
      }
      if (parts.length >= 4 && parts[2] === "tree") {
        const [owner, repo, , branch] = parts;
        return `https://github.com/${owner}/${
          repo.replace(/\.git$/i, "")
        }/archive/refs/heads/${branch}.zip`;
      }
      if (parts.length >= 4 && (parts[2] === "blob" || parts[2] === "raw")) {
        const [owner, repo, , branch, ...filePath] = parts;
        return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${
          filePath.join("/")
        }`;
      }
    }
  } catch {
    // Fall back to cleanUrl if URL parsing fails
  }
  return cleanUrl;
}

/**
 * Fetches files from a remote URL. Supports both .rpy text files and .zip archives.
 * Throws readable network and CORS errors.
 */
export async function fetchFilesFromUrl(
  urlStr: string,
): Promise<UploadedFile[]> {
  let url = urlStr.trim();
  if (!/^https?:\/\//i.test(url)) {
    url = "https://" + url;
  }
  const resolvedUrl = resolveGithubUrl(url);
  let response: Response;

  try {
    response = await fetch(resolvedUrl);
    if (
      response.status === 404 && resolvedUrl.endsWith("/refs/heads/main.zip")
    ) {
      const masterUrl = resolvedUrl.replace(
        "/refs/heads/main.zip",
        "/refs/heads/master.zip",
      );
      const masterRes = await fetch(masterUrl);
      if (masterRes.ok) {
        response = masterRes;
      }
    }
  } catch {
    throw new Error(
      `Network request failed. This is likely due to a CORS policy restriction on the target host. ` +
        `Note: GitHub repository ZIP downloads and raw.githubusercontent.com files are fully supported.`,
    );
  }

  if (!response.ok) {
    throw new Error(
      `Failed to fetch from URL: ${response.statusText} (${response.status})`,
    );
  }

  const contentType = response.headers.get("Content-Type") || "";
  const urlPath = resolvedUrl.split("?")[0]!.split("#")[0]!;
  const urlLower = urlPath.toLowerCase();

  let buffer: ArrayBuffer;
  let textContent: string | null = null;
  if (typeof response.arrayBuffer === "function") {
    buffer = await response.arrayBuffer();
  } else if (typeof response.text === "function") {
    textContent = await response.text();
    const encoded = new TextEncoder().encode(textContent);
    buffer = encoded.buffer.slice(
      encoded.byteOffset,
      encoded.byteOffset + encoded.byteLength,
    ) as ArrayBuffer;
  } else {
    buffer = new ArrayBuffer(0);
  }

  const bytes = new Uint8Array(buffer);
  const isZipMagic = bytes.length >= 4 &&
    bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 &&
    bytes[3] === 0x04;
  const isZip = isZipMagic || urlLower.endsWith(".zip") ||
    contentType.includes("zip");

  if (isZip) {
    const parts = urlPath.split("/");
    const name = parts[parts.length - 1] || "archive.zip";
    const zipVirtualFile: UploadedFile = {
      name,
      size: buffer.byteLength,
      text: () => Promise.resolve(""),
      arrayBuffer: () => Promise.resolve(buffer),
      file: typeof File !== "undefined"
        ? new File([buffer], name, { type: "application/zip" })
        : undefined,
    };
    return extractRpyFilesFromZip(zipVirtualFile);
  } else {
    // Treat as raw script
    const text = textContent ?? new TextDecoder("utf-8").decode(buffer);
    const parts = urlPath.split("/");
    const name = parts[parts.length - 1] || "script.rpy";
    if (!name.toLowerCase().endsWith(".rpy") && !text.includes("label ")) {
      throw new Error(
        `The fetched URL does not appear to be a .rpy script or a .zip archive. ` +
          `Detected Content-Type: "${contentType}".`,
      );
    }
    const encoded = new TextEncoder().encode(text);
    return [
      {
        name: name.toLowerCase().endsWith(".rpy") ? name : `${name}.rpy`,
        size: encoded.byteLength,
        text: () => Promise.resolve(text),
        arrayBuffer: () =>
          Promise.resolve(
            encoded.buffer.slice(
              encoded.byteOffset,
              encoded.byteOffset + encoded.byteLength,
            ) as ArrayBuffer,
          ),
      },
    ];
  }
}
