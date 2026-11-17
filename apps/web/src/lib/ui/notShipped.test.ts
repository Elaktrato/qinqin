// The component gallery (lib/ui/testing/Gallery.svelte) and the test
// harnesses never ship: no route or app module imports them, and the built
// app (when a build exists) holds no trace of the gallery's markup.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const web = join(__dirname, '..', '..', '..');

function files(dir: string, keep: (p: string) => boolean): string[] {
	const out: string[] = [];
	for (const name of readdirSync(dir)) {
		const p = join(dir, name);
		if (statSync(p).isDirectory()) out.push(...files(p, keep));
		else if (keep(p)) out.push(p);
	}
	return out;
}

describe('the gallery is not shipped', () => {
	it('no app module imports lib/ui/testing', () => {
		const src = join(web, 'src');
		const app = files(src, (p) => /\.(svelte|ts)$/.test(p))
			.map((p) => relative(src, p))
			.filter((rel) => !/\.test\.(ts|svelte)$/.test(rel) && !/(^|\/)testing\//.test(rel));
		const offenders = app.filter((rel) => /from ['"][^'"]*ui\/testing\//.test(readFileSync(join(src, rel), 'utf8')));
		expect(offenders).toEqual([]);
	});

	it.runIf(existsSync(join(web, 'build')))('the build holds no gallery markup', () => {
		const built = files(join(web, 'build'), (p) => /\.(js|html|css)$/.test(p));
		expect(built.length).toBeGreaterThan(0);
		const offenders = built.filter((p) => readFileSync(p, 'utf8').includes('data-gallery'));
		expect(offenders.map((p) => relative(web, p))).toEqual([]);
	});
});
