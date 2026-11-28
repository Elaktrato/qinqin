import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { readImagesPackage } from './imagesIndex';
import { readZip, zipMember } from './zip';

// The real images packages (#274), when QINQIN_IMAGES_PACKAGE_FILES names a directory of them (written by the Go test
// TestBuiltImagesPackages with QINQIN_IMAGES_PACKAGES_OUT): the web's readers read every picture and map row.
// Skipped without the variable (the packs are built, not committed).
const dir = process.env.QINQIN_IMAGES_PACKAGE_FILES ?? '';

describe.skipIf(dir === '')('the real images packages', () => {
	it('read whole', async () => {
		const files = readdirSync(dir).filter((f) => f.endsWith('.qqpkg'));
		expect(files.length).toBeGreaterThan(0);
		for (const f of files) {
			const bytes = new Uint8Array(readFileSync(join(dir, f)));
			const zip = readZip(bytes);
			const index = readImagesPackage(await zipMember(bytes, zip.get('data.sqlite')!));
			const rows = [...index.map.values()].reduce((n, m) => n + [...m.values()].reduce((k, l) => k + l.length, 0), 0);
			expect(rows).toBeGreaterThan(1000);
			expect(index.pictures.size).toBeGreaterThan(500);
			for (const p of index.pictures.values()) expect(p.svg.startsWith('<svg')).toBe(true);
		}
	});
});
