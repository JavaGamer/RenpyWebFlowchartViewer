export function menuHasFallthrough(menu: {
  id: string;
  optionText: string | null;
  options?: Array<{ text: string; hasExit: boolean }>;
}): boolean {
  if (!menu.options || menu.options.length === 0) {
    return true;
  }
  return menu.options.some((opt) => !opt.hasExit);
}
