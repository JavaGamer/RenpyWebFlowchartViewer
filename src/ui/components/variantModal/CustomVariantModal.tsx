import { useEffect } from "react";
import type { CustomVariantModalProps } from "./types.ts";
import { CustomVariantFormContent } from "./CustomVariantFormContent.tsx";

export function CustomVariantModal({
  isOpen,
  onClose,
  onSave,
  initialDefinition,
  isDark = false,
}: CustomVariantModalProps) {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="custom-variant-modal-title"
    >
      <CustomVariantFormContent
        key={initialDefinition?.id ?? "new"}
        initialDefinition={initialDefinition}
        onClose={onClose}
        onSave={onSave}
        isDark={isDark}
      />
    </div>
  );
}

export default CustomVariantModal;
