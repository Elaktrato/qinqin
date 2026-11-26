import type { Shape } from './raster.mjs';
export const BLUE: [number, number, number];
export function markShapes(options?: { maskable?: boolean }): Shape[];
export function logoPath(): string;
export function faviconSvg(): string;
export const ICONS: readonly { file: string; size: number; maskable: boolean }[];
