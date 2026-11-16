export interface RRect {
	type: 'rrect';
	x: number;
	y: number;
	w: number;
	h: number;
	r: number;
	color: [number, number, number];
}
export function rasterize(width: number, height: number, shapes: readonly RRect[], supersample?: number): Uint8Array;
export function encodePng(width: number, height: number, rgba: Uint8Array): Uint8Array;
