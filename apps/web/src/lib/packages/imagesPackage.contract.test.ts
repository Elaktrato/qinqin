import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import fixture from '../../../../../docs/contracts/images/package.json';
import { checkPackage, PackageCheckError, sha256Hex } from './check';
import { IMAGES_FORMATS, readImagesPackage } from './imagesIndex';
import { openSqlite } from './sqlite';
import { readZip, zipMember } from './zip';

// docs/contracts/images/package.qqpkg: a package the server's builder wrote (Go:
// server/internal/datapkg/images_fixture_test.go). The web's zip and package database readers read it to exactly the
// rows package.json lists.
const file = new Uint8Array(readFileSync(join(__dirname, '../../../../../docs/contracts/images', fixture.file)));

async function row() {
	return { id: fixture.id, revision: fixture.revision, contentHash: fixture.contentHash, sha256: await sha256Hex(file) };
}

describe('docs/contracts/images/package.qqpkg', () => {
	it('reads the zip members', async () => {
		const members = readZip(file);
		expect([...members.keys()].sort()).toEqual(['LICENSES/pics-fixture/LICENSE', 'NOTICE.md', 'data.sqlite', 'manifest.json']);
		const data = await zipMember(file, members.get('data.sqlite')!);
		expect(data.length).toBeGreaterThan(3 * 4096);
	});

	it('passes the four checks and reads the rows package.json lists', async () => {
		const checked = await checkPackage(file, await row(), fixture.instanceId, IMAGES_FORMATS);
		const db = openSqlite(checked.files.get('data.sqlite')!);
		const pictures = db.rows('pictures').map((r) => ({ concept: r.concept, label: r.label, credit: r.credit, svg: r.svg }));
		expect(pictures).toEqual(fixture.pictures);
		const map = db.rows('map').map((r) => [r.language, r.target, r.sense, r.concept, r.score, r.basis]);
		const order = (a: unknown[], b: unknown[]) => {
			for (const i of [0, 1, 2, 3]) {
				if (a[i] !== b[i]) return (a[i] as string | number) < (b[i] as string | number) ? -1 : 1;
			}
			return 0;
		};
		expect(map.sort(order)).toEqual([...fixture.map].sort(order));
		const index = readImagesPackage(checked.files.get('data.sqlite')!);
		expect(index.packId).toBe('pics-fixture');
		expect(index.license).toBe('CC BY-SA 4.0');
		expect(index.pictures.get('LONG')?.svg.length).toBeGreaterThan(4096);
	});

	it('refuses a changed file, another revision or server, an unknown format', async () => {
		const good = await row();
		const bad = file.slice();
		bad[bad.length - 30] ^= 1;
		await expect(checkPackage(bad, good, fixture.instanceId, IMAGES_FORMATS)).rejects.toBeInstanceOf(PackageCheckError);
		await expect(checkPackage(file, { ...good, revision: good.revision + 1 }, fixture.instanceId, IMAGES_FORMATS)).rejects.toBeInstanceOf(PackageCheckError);
		await expect(checkPackage(file, good, '01JD8Z3Q4M5N6P7R8S9T0V1W2Y', IMAGES_FORMATS)).rejects.toBeInstanceOf(PackageCheckError);
		await expect(checkPackage(file, good, fixture.instanceId, [2])).rejects.toBeInstanceOf(PackageCheckError);
	});
});
