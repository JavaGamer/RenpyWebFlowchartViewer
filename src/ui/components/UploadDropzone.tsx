import React from "react";
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
  return (
    <label
      htmlFor="folder-input"
      aria-label="Upload Ren'Py project folder"
      onDrop={onDrop}
      onDragOver={onDragOver}
      className={cn(
        "flex flex-col items-center justify-center gap-4 w-full min-h-64 rounded-2xl border-2 border-dashed transition-all p-5 sm:p-6 select-none",
        isDark
          ? "border-violet-800 bg-slate-900 cursor-pointer hover:bg-violet-950/20 hover:border-violet-700"
          : "border-violet-300 bg-white cursor-pointer hover:bg-violet-50/50 hover:border-violet-400",
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
          <span
            className={cn(
              "font-semibold underline cursor-pointer px-1 transition-colors duration-200 focus-within:ring-2 rounded",
              isDark
                ? "text-violet-400 hover:text-violet-300"
                : "text-violet-600 hover:text-violet-800",
            )}
          >
            select a folder
          </span>{" "}
          or{" "}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              openFilesPicker();
            }}
            className={cn(
              "font-semibold underline focus:outline-none focus-visible:ring-2 rounded px-1 transition-colors duration-200",
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
    </label>
  );
}
