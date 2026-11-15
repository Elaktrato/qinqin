// The QR code of an otpauth:// URI as drawable runs. uqr (MIT, no
// dependencies) makes the module matrix; the page draws it as SVG <rect>s,
// never as injected markup.

import { encode } from 'uqr';

export interface QrRun {
	x: number;
	y: number;
	/** Length in modules of a horizontal run of dark modules. */
	w: number;
}

export interface QrDrawing {
	/** The matrix is size x size modules (without the quiet zone). */
	size: number;
	runs: QrRun[];
}

/**
 * qrDrawing encodes text (medium error correction, so a phone camera copes
 * with a smudged screen) and merges neighbouring dark modules of a row into
 * runs: far fewer elements than one rect per module.
 */
export function qrDrawing(text: string): QrDrawing {
	const matrix = encode(text, { ecc: 'M', border: 0 }).data;
	const runs: QrRun[] = [];
	matrix.forEach((row, y) => {
		let start = -1;
		row.forEach((dark, x) => {
			if (dark && start < 0) start = x;
			if (!dark && start >= 0) {
				runs.push({ x: start, y, w: x - start });
				start = -1;
			}
		});
		if (start >= 0) runs.push({ x: start, y, w: row.length - start });
	});
	return { size: matrix.length, runs };
}

/** The quiet zone every QR reader expects around the code, in modules. */
export const QUIET_ZONE = 4;
