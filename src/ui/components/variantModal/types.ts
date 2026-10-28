import type { CustomVariantDefinition } from "../../../config/parserRules.ts";

export interface CustomVariantModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (def: CustomVariantDefinition) => void;
  initialDefinition?: CustomVariantDefinition | null;
  isDark?: boolean;
}
