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
export function resolveGithubUrl(urlStr: string): string {
  const url = urlStr.trim();
  const githubRepoRegex =
    /^https?:\/\/(www\.)?github\.com\/([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)\/?$/;
  const repoMatch = url.match(githubRepoRegex);
  if (repoMatch) {
    const owner = repoMatch[2];
    const repo = repoMatch[3]!.replace(/\.git$/i, "");
    return `https://github.com/${owner}/${repo}/archive/refs/heads/main.zip`;
  }

  const githubTreeRegex =
    /^https?:\/\/(www\.)?github\.com\/([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)\/tree\/([a-zA-Z0-9_./-]+)\/?$/;
  const treeMatch = url.match(githubTreeRegex);
  if (treeMatch) {
    const owner = treeMatch[2];
    const repo = treeMatch[3]!.replace(/\.git$/i, "");
    let branch = treeMatch[4]!;
    const parts = branch.split("/");
    if (
      parts.length > 1 &&
      (parts[0] === "main" ||
        parts[0] === "master" ||
        parts[0] === "dev" ||
        parts[0] === "develop")
    ) {
      branch = parts[0];
    }
    return `https://github.com/${owner}/${repo}/archive/refs/heads/${branch}.zip`;
  }

  const githubFileRegex =
    /^https?:\/\/(www\.)?github\.com\/([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)\/(?:blob|raw)\/(.+)$/;
  const fileMatch = url.match(githubFileRegex);
  if (fileMatch) {
    const owner = fileMatch[2];
    const repo = fileMatch[3]!.replace(/\.git$/i, "");
    const rest = fileMatch[4]!;
    return `https://raw.githubusercontent.com/${owner}/${repo}/${rest}`;
  }

  return url;
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
  const cleanUrl = resolvedUrl.split("?")[0]!.split("#")[0]!;
  const urlLower = cleanUrl.toLowerCase();
  const isZip = urlLower.endsWith(".zip") ||
    (!urlLower.endsWith(".rpy") && contentType.includes("zip"));

  if (isZip) {
    const buffer = await response.arrayBuffer();
    const parts = cleanUrl.split("/");
    const name = parts[parts.length - 1] || "archive.zip";
    const zipVirtualFile: UploadedFile = {
      name,
      size: buffer.byteLength,
      text: async () => "",
      arrayBuffer: async () => buffer,
    };
    return extractRpyFilesFromZip(zipVirtualFile);
  } else {
    // Treat as raw script
    const textContent = await response.text();
    const parts = cleanUrl.split("/");
    const name = parts[parts.length - 1] || "script.rpy";
    if (!name.toLowerCase().endsWith(".rpy")) {
      throw new Error(
        `The fetched URL does not appear to be a .rpy script or a .zip archive. ` +
          `Detected Content-Type: "${contentType}".`,
      );
    }
    return [
      {
        name,
        size: new TextEncoder().encode(textContent).byteLength,
        text: async () => textContent,
      },
    ];
  }
}
