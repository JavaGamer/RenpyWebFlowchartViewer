import React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "../utils/cn.ts";

export interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  variant?: "centered" | "sidebar";
  modal?: boolean;
  isDark?: boolean;
  children: React.ReactNode;
  headerAction?: React.ReactNode;
  className?: string;
}

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  variant = "centered",
  modal = true,
  isDark = false,
  children,
  headerAction,
  className,
}: ModalProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange} modal={modal}>
      <Dialog.Portal>
        {variant === "centered"
          ? (
            <>
              <Dialog.Overlay className="fixed inset-0 z-50 bg-gray-900/80 backdrop-blur-sm transition-opacity duration-300" />
              <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                <Dialog.Content
                  className={cn(
                    "relative w-full max-w-lg rounded-2xl shadow-2xl ring-1 ring-white/10 flex flex-col focus:outline-none",
                    "animate-in fade-in slide-in-from-bottom-4 duration-300",
                    isDark
                      ? "bg-slate-900 text-slate-100 ring-white/10"
                      : "bg-white text-gray-900 ring-black/5",
                    className,
                  )}
                >
                  <div className="flex items-center justify-between px-6 pt-5 pb-3">
                    <div>
                      <Dialog.Title className="text-base font-semibold">
                        {title}
                      </Dialog.Title>
                      {description && (
                        <Dialog.Description className="text-xs text-gray-500 mt-0.5">
                          {description}
                        </Dialog.Description>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {headerAction}
                      <Dialog.Close className="rounded-lg p-1.5 text-gray-500 hover:bg-white/5 hover:text-gray-300 transition-colors duration-200">
                        <X size={16} />
                      </Dialog.Close>
                    </div>
                  </div>
                  <div className="flex-1 overflow-y-auto px-6 pb-6">
                    {children}
                  </div>
                </Dialog.Content>
              </div>
            </>
          )
          : (
            <>
              {/* Sidebar Overlay */}
              <div
                className="fixed inset-0 bg-black/45 backdrop-blur-sm z-50 animate-fade-in"
                aria-hidden="true"
              />
              <Dialog.Content
                className={cn(
                  "fixed right-0 top-0 bottom-0 w-full max-w-md shadow-2xl z-50 flex flex-col focus:outline-none animate-slide-in transition-colors duration-200",
                  isDark
                    ? "bg-slate-900 border-l border-slate-800 text-slate-100"
                    : "bg-white text-gray-900",
                  className,
                )}
                aria-modal={modal ? "true" : "false"}
                onInteractOutside={(e) => !modal && e.preventDefault()}
              >
                <div
                  className={cn(
                    "flex items-center justify-between px-6 py-4 border-b shrink-0 transition-colors duration-200",
                    isDark
                      ? "border-slate-800 bg-slate-800"
                      : "border-gray-100 bg-gray-50/50",
                  )}
                >
                  <div>
                    <Dialog.Title className="text-base font-semibold">
                      {title}
                    </Dialog.Title>
                    {description && (
                      <Dialog.Description className="text-xs mt-0.5 text-gray-500">
                        {description}
                      </Dialog.Description>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {headerAction}
                    <Dialog.Close className="rounded-lg p-1.5 text-gray-500 hover:bg-white/5 hover:text-gray-300 transition-colors duration-200">
                      <X size={16} />
                    </Dialog.Close>
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto">
                  {children}
                </div>
              </Dialog.Content>
            </>
          )}
      </Dialog.Portal>
    </Dialog.Root>
  );
}
