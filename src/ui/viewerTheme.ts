import type { ThemeName } from './viewerTypes';

export interface ThemeColors {
  pageBg: string;
  panelBg: string;
  text: string;
  subtleText: string;
  labelBorder: string;
  labelBg: string;
  labelTitle: string;
  labelText: string;
  menuBorder: string;
  menuBg: string;
  menuTitle: string;
  menuText: string;
  edge: string;
  grid: string;
  minimapLabel: string;
  minimapMenu: string;
}

export const THEMES: Record<ThemeName, ThemeColors> = {
  violet: {
    pageBg: '#f9fafb',
    panelBg: '#ffffff',
    text: '#111827',
    subtleText: '#4b5563',
    labelBorder: '#7c3aed',
    labelBg: '#f5f3ff',
    labelTitle: '#8b5cf6',
    labelText: '#4c1d95',
    menuBorder: '#d97706',
    menuBg: '#fffbeb',
    menuTitle: '#f59e0b',
    menuText: '#78350f',
    edge: '#4b5563',
    grid: '#d1d5db',
    minimapLabel: '#8b5cf6',
    minimapMenu: '#f59e0b',
  },
  highContrast: {
    pageBg: '#ffffff',
    panelBg: '#ffffff',
    text: '#000000',
    subtleText: '#111111',
    labelBorder: '#000000',
    labelBg: '#ffffff',
    labelTitle: '#111111',
    labelText: '#000000',
    menuBorder: '#000000',
    menuBg: '#f3f4f6',
    menuTitle: '#111111',
    menuText: '#000000',
    edge: '#000000',
    grid: '#9ca3af',
    minimapLabel: '#000000',
    minimapMenu: '#4b5563',
  },
  colorblind: {
    pageBg: '#f8fafc',
    panelBg: '#ffffff',
    text: '#0f172a',
    subtleText: '#334155',
    labelBorder: '#0072b2',
    labelBg: '#e0f2fe',
    labelTitle: '#0369a1',
    labelText: '#0c4a6e',
    menuBorder: '#e69f00',
    menuBg: '#fff7cc',
    menuTitle: '#a16207',
    menuText: '#713f12',
    edge: '#334155',
    grid: '#cbd5e1',
    minimapLabel: '#0072b2',
    minimapMenu: '#e69f00',
  },
};
