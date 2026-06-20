import React from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { cn } from "../utils/cn.ts";
import type { UploadFileStatus } from "../../application/index.ts";

interface UploadProgressProps {
  isDark: boolean;
  phase: string;
  fileCount: number;
  doneFiles: number;
  totalFiles: number;
  progressPercent: number;
  currentFile?: string;
  uploadedFiles: UploadFileStatus[];
  onDrop: (e: React.DragEvent<HTMLLabelElement>) => void;
  onDragOver: (e: React.DragEvent<HTMLLabelElement>) => void;
}

export function UploadProgress({
  isDark,
  phase,
  fileCount,
  doneFiles,
  totalFiles,
  progressPercent,
  currentFile,
  uploadedFiles,
  onDrop,
  onDragOver,
}: UploadProgressProps) {
  return (
    <label
      htmlFor="folder-input"
      aria-label="Upload Ren'Py project folder"
      onDrop={onDrop}
      onDragOver={onDragOver}
      className={cn(
        "flex flex-col items-center justify-center gap-4 w-full min-h-64 rounded-2xl border-2 border-dashed transition-all p-5 sm:p-6 select-none cursor-wait border-violet-200/50",
        isDark ? "bg-slate-900" : "bg-white",
      )}
    >
      <div className="w-full flex flex-col items-center gap-4">
        <Loader2
          size={40}
          className="text-violet-500 animate-spin"
          aria-hidden="true"
        />

        <div className="text-center w-full">
          <p
            className={cn(
              "text-sm font-semibold",
              isDark ? "text-slate-200" : "text-gray-700",
            )}
          >
            {phase === "reading"
              ? `Reading ${
                fileCount === 0 ? "scanning..." : `${fileCount} file(s)...`
              }`
              : `Parsing ${doneFiles} / ${totalFiles} .rpy files…`}
          </p>
          {currentFile && (
            <p
              className={cn(
                "text-xs mt-1 truncate max-w-md mx-auto",
                isDark ? "text-slate-450" : "text-gray-450",
              )}
              title={currentFile}
            >
              Current: {currentFile}
            </p>
          )}
        </div>

        {/* Global Progress Bar */}
        <div
          className={cn(
            "w-full max-w-md rounded-full h-2 overflow-hidden mt-1 border",
            isDark
              ? "bg-slate-800 border-slate-700/50"
              : "bg-gray-100 border-gray-200/50",
          )}
        >
          <div
            className="bg-violet-600 h-2 rounded-full transition-all duration-300 animate-pulse"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        <span
          className={cn(
            "text-[10px] font-semibold",
            isDark ? "text-slate-400" : "text-gray-400",
          )}
        >
          {progressPercent}% Completed
        </span>

        {/* File-by-file Status Tracker */}
        {uploadedFiles.length > 0 && (
          <div
            className={cn(
              "w-full max-w-md mt-4 border rounded-xl p-2.5 max-h-48 overflow-y-auto space-y-1.5 scrollbar-thin",
              isDark
                ? "border-slate-800 bg-slate-900/50"
                : "border-gray-200/60 bg-gray-50/50",
            )}
          >
            {uploadedFiles.map((file) => {
              const sizeKB = (file.size / 1024).toFixed(1);
              return (
                <div
                  key={file.id}
                  className={cn(
                    "flex items-center justify-between gap-3 p-2 border rounded-lg text-[11px] transition-colors duration-200",
                    isDark
                      ? "bg-slate-900 border-slate-800"
                      : "bg-white border-gray-150 shadow-sm",
                  )}
                >
                  <div className="min-w-0 flex-1 text-left">
                    <p
                      className={cn(
                        "font-semibold truncate",
                        isDark ? "text-slate-200" : "text-gray-700",
                      )}
                      title={file.name}
                    >
                      {file.name}
                    </p>
                    {file.relativePath && (
                      <p
                        className={cn(
                          "text-[9px] truncate",
                          isDark ? "text-slate-500" : "text-gray-400",
                        )}
                        title={file.relativePath}
                      >
                        {file.relativePath.substring(
                          0,
                          file.relativePath.lastIndexOf("/") + 1,
                        )}
                      </p>
                    )}
                  </div>
                  <div className="shrink-0 flex items-center gap-2">
                    <span
                      className={cn(
                        "text-[9px]",
                        isDark ? "text-slate-500" : "text-gray-400",
                      )}
                    >
                      {sizeKB} KB
                    </span>
                    <span
                      className={cn(
                        "px-1.5 py-0.5 rounded-full text-[9px] font-semibold tracking-wide border",
                        file.status === "pending"
                          ? isDark
                            ? "bg-slate-950 text-slate-550 border-slate-800"
                            : "bg-gray-50 text-gray-500 border-gray-200"
                          : file.status === "reading"
                          ? isDark
                            ? "bg-blue-955/50 text-blue-300 border-blue-900/60 animate-pulse"
                            : "bg-blue-50 text-blue-700 border-blue-200 animate-pulse"
                          : file.status === "parsing"
                          ? isDark
                            ? "bg-violet-955/50 text-violet-300 border-violet-900/60 animate-pulse"
                            : "bg-violet-50 text-violet-700 border-violet-200 animate-pulse"
                          : file.status === "done"
                          ? isDark
                            ? "bg-green-950/50 text-green-300 border-green-900/60"
                            : "bg-green-50 text-green-700 border-green-200"
                          : isDark
                          ? "bg-red-955/50 text-red-350 border-red-900/60"
                          : "bg-red-50 text-red-700 border-red-200",
                      )}
                      title={file.error}
                    >
                      {file.status.toUpperCase()}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Large project warning */}
        {totalFiles >= 200 && (
          <div
            className={cn(
              "w-full max-w-md mt-3 flex items-start gap-2 p-3 rounded-xl border text-[11px] text-left shadow-sm transition-colors duration-200",
              isDark
                ? "bg-amber-955/40 border-amber-900/60 text-amber-300"
                : "bg-amber-50 border-amber-200 text-amber-800",
            )}
          >
            <AlertCircle
              size={16}
              className="shrink-0 mt-0.5"
              aria-hidden="true"
            />
            <div>
              <p className="font-semibold">
                Large project warning ({totalFiles} files)
              </p>
              <p
                className={cn(
                  "mt-0.5 text-[10px]",
                  isDark ? "text-amber-400" : "text-amber-700",
                )}
              >
                Generating flowchart layout may take a few moments. We've
                automatically activated performance mode (label/count search
                only) to optimize speed.
              </p>
            </div>
          </div>
        )}
      </div>
    </label>
  );
}
