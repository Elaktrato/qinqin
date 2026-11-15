import { describe, expect, it } from 'vitest';
import { encode } from 'uqr';
import { qrDrawing } from './qrMatrix';

const URI = 'otpauth://totp/qinqin:bobby?secret=JBSWY3DPEHPK3PXP&issuer=qinqin&algorithm=SHA1&digits=6&period=30';

describe('qrDrawing', () => {
	it('draws a square matrix whose dark modules are exactly the runs', () => {
		const matrix = encode(URI, { ecc: 'M', border: 0 }).data;
		const d = qrDrawing(URI);
		expect(d.size).toBe(matrix.length);
		expect(matrix.every((row) => row.length === d.size)).toBe(true);
		const dark = matrix.flat().filter(Boolean).length;
		expect(d.runs.reduce((n, r) => n + r.w, 0)).toBe(dark);
		for (const r of d.runs) {
			expect(r.w).toBeGreaterThan(0);
			for (let i = 0; i < r.w; i++) expect(matrix[r.y][r.x + i]).toBe(true);
			// a run never touches the next dark module (it would have been merged)
			expect(matrix[r.y][r.x + r.w] ?? false).toBe(false);
			if (r.x > 0) expect(matrix[r.y][r.x - 1]).toBe(false);
		}
	});
	it('has the three finder patterns (dark 7-module rows in three corners)', () => {
		const d = qrDrawing(URI);
		const top = d.runs.filter((r) => r.y === 0 && r.w === 7);
		expect(top.some((r) => r.x === 0)).toBe(true);
		expect(top.some((r) => r.x === d.size - 7)).toBe(true);
		expect(d.runs.some((r) => r.y === d.size - 7 && r.x === 0 && r.w === 7)).toBe(true);
	});
	it('is deterministic and grows with the input', () => {
		expect(qrDrawing(URI)).toEqual(qrDrawing(URI));
		expect(qrDrawing('a').size).toBeLessThan(qrDrawing(URI).size);
	});
});
