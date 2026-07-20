import { useEffect, useRef, useState } from "react";
import { ChevronDown, Clock, Trash2 } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { cn } from "../utils/cn.ts";
import {
  deleteProjectFromCache,
  getProjectFromCache,
  getRecentProjects,
  type RecentProject,
  saveProjectToCache,
} from "../../infrastructure/index.ts";
import { useAppStore, useViewerStore } from "../../application/index.ts";

export default function RecentProjectsDropdown() {
  const [isOpen, setIsOpen] = useState(false);
  const [projects, setProjects] = useState<RecentProject[]>([]);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const theme = useViewerStore((s) => s.theme);
  const isDark = theme === "dark";

  const { startParsing, parseSuccess, fail } = useAppStore(
    useShallow((s) => ({
      startParsing: s.startParsing,
      parseSuccess: s.parseSuccess,
      fail: s.fail,
    })),
  );

  const reloadProjects = async () => {
    const list = await getRecentProjects();
    setProjects(list);
  };

  useEffect(() => {
    let isMounted = true;
    getRecentProjects().then((list) => {
      if (isMounted) {
        setProjects(list);
      }
    });
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelectProject = async (id: string) => {
    setIsOpen(false);
    startParsing();
    const project = await getProjectFromCache(id);
    if (project) {
      await saveProjectToCache({ ...project, lastAccessed: 0 }); // 0 triggers default timestamp in saveProjectToCache
      parseSuccess(project.nodes, project.edges, project.diagnostics);
    } else {
      fail("Failed to load project from cache.");
    }
    await reloadProjects();
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    await deleteProjectFromCache(id);
    await reloadProjects();
  };

  if (projects.length === 0) return null;

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors border",
          isDark
            ? "bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700"
            : "bg-white border-gray-200 text-gray-700 hover:bg-gray-50",
        )}
      >
        <Clock size={14} />
        <span className="hidden sm:inline">Recent</span>
        <ChevronDown
          size={14}
          className={cn(
            "transition-transform duration-200",
            isOpen && "rotate-180",
          )}
        />
      </button>

      {isOpen && (
        <div
          className={cn(
            "absolute right-0 mt-2 w-64 rounded-lg shadow-lg border overflow-hidden z-50",
            isDark
              ? "bg-slate-800 border-slate-700"
              : "bg-white border-gray-200",
          )}
        >
          <div
            className={cn(
              "px-3 py-2 text-xs font-semibold border-b",
              isDark
                ? "border-slate-700 text-slate-400"
                : "border-gray-100 text-gray-500",
            )}
          >
            Recent Projects
          </div>
          <div className="max-h-60 overflow-y-auto">
            {projects.map((p) => (
              <button
                type="button"
                key={p.id}
                onClick={() => handleSelectProject(p.id)}
                className={cn(
                  "w-full text-left flex items-center justify-between px-3 py-2 cursor-pointer transition-colors group",
                  isDark
                    ? "hover:bg-slate-700 text-slate-300"
                    : "hover:bg-violet-50 text-gray-700",
                )}
              >
                <div className="flex flex-col min-w-0">
                  <span className="text-sm font-medium truncate">{p.name}</span>
                  <span
                    className={cn(
                      "text-xs",
                      isDark ? "text-slate-500" : "text-gray-400",
                    )}
                  >
                    {p.fileCount} files •{" "}
                    {new Date(p.lastAccessed).toLocaleDateString()}
                  </span>
                </div>
                <div
                  onClick={(e) => handleDelete(e, p.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      handleDelete(e as unknown as React.MouseEvent, p.id);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  className={cn(
                    "p-1.5 rounded opacity-0 group-hover:opacity-100 transition-opacity",
                    isDark
                      ? "text-slate-400 hover:text-red-400 hover:bg-slate-600"
                      : "text-gray-400 hover:text-red-600 hover:bg-red-50",
                  )}
                  title="Remove from history"
                >
                  <Trash2 size={14} />
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
