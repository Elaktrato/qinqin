import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs script without types
import { build, RES } from '../scripts/make-icons.mjs';

// The launcher icon is the qinqin logo (see scripts/make-icons.mjs). This fails when the logo changed and the icon
// files were not regenerated (`node scripts/make-icons.mjs`).
describe('launcher icon', () => {
	const built = build() as Record<string, string | Buffer>;
	it('has a vector foreground that matches the logo', () => {
		expect(readFileSync(RES + 'drawable/ic_launcher_foreground.xml', 'utf8')).toBe(built['drawable/ic_launcher_foreground.xml']);
	});
	it('has a status-bar icon for notifications that matches the logo', () => {
		expect(readFileSync(RES + 'drawable/ic_stat_qinqin.xml', 'utf8')).toBe(built['drawable/ic_stat_qinqin.xml']);
	});
	it('has 192 px legacy icons for API 24 and 25', () => {
		for (const f of ['mipmap-nodpi/ic_launcher.png', 'mipmap-nodpi/ic_launcher_round.png']) {
			const png = readFileSync(RES + f);
			expect(png.subarray(1, 4).toString()).toBe('PNG');
			expect(png.readUInt32BE(16)).toBe(192);
			expect(png.readUInt32BE(20)).toBe(192);
			expect((built[f] as Buffer).readUInt32BE(16)).toBe(192);
		}
	});
	it('gives the adaptive icons a themed (monochrome) layer from the same drawable', () => {
		for (const f of ['ic_launcher', 'ic_launcher_round']) {
			const xml = readFileSync(RES + `mipmap-anydpi-v26/${f}.xml`, 'utf8');
			expect(xml).toContain('<foreground android:drawable="@drawable/ic_launcher_foreground"/>');
			expect(xml).toContain('<monochrome android:drawable="@drawable/ic_launcher_foreground"/>');
		}
	});
});
