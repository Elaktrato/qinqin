export interface RRect {
	type: 'rrect';
	x: number;
	y: number;
	w: number;
	h: number;
	r: number;
	color: [number, number, number];
}
export interface Poly {
	type: 'poly';
	/** Closed outlines in unit coordinates, filled with the non-zero winding rule. */
	subpaths: readonly (readonly (readonly [number, number])[])[];
	color: [number, number, number];
}
export type Shape = RRect | Poly;
export function rasterize(width: number, height: number, shapes: readonly Shape[], supersample?: number): Uint8Array;
export function encodePng(width: number, height: number, rgba: Uint8Array): Uint8Array;
