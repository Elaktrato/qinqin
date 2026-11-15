// Types for writing-ink-model.mjs (a plain script shared by the fixture generator and tests).
export type Pt = { x: number; y: number };
export type Rnd = () => number;
export interface HandOptions {
	amp?: number;
	endFrac?: number;
	rotDeg?: number;
	jitter?: number;
}
export function mulberry32(seed: number): Rnd;
export function length(ps: readonly Pt[]): number;
export function resample(ps: readonly Pt[], n: number): Pt[];
export function centroid(ps: readonly Pt[]): Pt;
export function features(m: readonly Pt[]): { dense: Pt[]; tail: number | null; corners: number[]; L: number };
export function straight(m: readonly Pt[]): Pt[];
export function hookOmitted(m: readonly Pt[]): Pt[] | null;
export function hookExaggerated(m: readonly Pt[], factor?: number): Pt[] | null;
export function cornerRounded(m: readonly Pt[], frac?: number): Pt[] | null;
export function hand(m: readonly Pt[], rnd: Rnd, options?: HandOptions): Pt[];
export function rotate(ps: readonly Pt[], deg: number): Pt[];
export function shift(ps: readonly Pt[], dx: number, dy: number): Pt[];
export function scale(ps: readonly Pt[], f: number): Pt[];
export function correctVariants(m: readonly Pt[], rnd: Rnd, hands?: number): [string, Pt[]][];
