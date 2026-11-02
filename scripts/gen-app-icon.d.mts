import type { Buffer } from "node:buffer";

export const projectRoot: string;

export const BRAND: {
  bg: number[];
  keyWhite: number[];
  keyGold: number[];
};

export function encodePng(width: number, height: number, rgba: Uint8Array): Buffer;

export function renderLegacyIcon(size: number): Buffer;
export function renderRoundIcon(size: number): Buffer;
export function renderAdaptiveForeground(size: number): Buffer;
export function renderIosAppIcon(size?: number): Buffer;
export function renderSplash(width: number, height: number): Buffer;

export type IconTarget = [path: string, build: () => Buffer];

export function iconTargets(): IconTarget[];

export function generateIcons(
  root?: string,
  options?: { check?: boolean },
): { total: number; drifted: string[] };
