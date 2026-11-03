import React, { useState } from "react";
import { Upload } from "lucide-react";
import { cn } from "../utils/cn.ts";

interface UploadDropzoneProps {
  isDark: boolean;
  openFilesPicker: (e?: React.MouseEvent) => void;
  onDrop: (e: React.DragEvent<HTMLElement>) => void;
  onDragOver: (e: React.DragEvent<HTMLElement>) => void;
}

export function UploadDropzone({
  isDark,
  openFilesPicker,
  onDrop,
  onDragOver,
}: UploadDropzoneProps) {
  const [isDragOver, setIsDragOver] = useState(false);

  return (
    <div
      role="region"
      aria-label="Upload Ren'Py project folder or files"
      onDragEnter={(e) => {
        e.preventDefault();
        setIsDragOver(true);
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        // Only reset if leaving the dropzone container itself
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setIsDragOver(false);
      }}
      onDragOver={(e) => {
        onDragOver(e);
        if (!isDragOver) setIsDragOver(true);
      }}
      onDrop={(e) => {
        setIsDragOver(false);
        onDrop(e);
      }}
      className={cn(
        "flex flex-col items-center justify-center gap-4 w-full min-h-64 rounded-2xl border-2 border-dashed transition-all p-5 sm:p-6 select-none",
        isDragOver
          ? isDark
            ? "border-violet-400 bg-violet-950/40 ring-4 ring-violet-500/30 scale-[1.01]"
            : "border-violet-500 bg-violet-50 ring-4 ring-violet-400/30 scale-[1.01]"
          : isDark
          ? "border-violet-800 bg-slate-900 hover:bg-violet-950/20 hover:border-violet-700"
          : "border-violet-300 bg-white hover:bg-violet-50/50 hover:border-violet-400",
      )}
    >
      <Upload
        size={40}
        className="text-violet-400 animate-bounce"
        aria-hidden="true"
      />
      <div className="text-center px-4">
        <p
          className={cn(
            "text-base font-semibold",
            isDark ? "text-slate-200" : "text-gray-700",
          )}
        >
          Drop your Ren'Py project folder here
        </p>
        <p className="text-sm text-gray-400 mt-2">
          or click to{" "}
          <label
            htmlFor="folder-input"
            aria-label="Upload Ren'Py project folder"
            className={cn(
              "font-semibold underline cursor-pointer px-1 transition-colors duration-200 focus-within:ring-2 rounded",
              isDark
                ? "text-violet-400 hover:text-violet-300"
                : "text-violet-600 hover:text-violet-800",
            )}
          >
            select a folder
          </label>{" "}
          or{" "}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              openFilesPicker();
            }}
            className={cn(
              "font-semibold underline cursor-pointer focus:outline-none focus-visible:ring-2 rounded px-1 transition-colors duration-200",
              isDark
                ? "text-violet-400 hover:text-violet-300 focus-visible:ring-violet-400"
                : "text-violet-600 hover:text-violet-800 focus-visible:ring-violet-500",
            )}
          >
            select files/ZIP
          </button>
        </p>
      </div>
      <span
        className={cn(
          "text-xs px-3 py-1 rounded-full transition-colors duration-200",
          isDark ? "text-slate-400 bg-slate-800" : "text-gray-400 bg-gray-100",
        )}
      >
        All processing is local — your files never leave your device
      </span>
    </div>
  );
}
