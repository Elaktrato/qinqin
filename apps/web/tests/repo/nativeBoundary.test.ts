import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Record 0010: lib/native is the web app's only door to the Android shell. Nothing else imports a @capacitor
// package or reads the injected Capacitor global.
const src = resolve(__dirname, '../../src');

function walk(dir: string): string[] {
	const out: string[] = [];
	for (const e of readdirSync(dir, { withFileTypes: true })) {
		const p = join(dir, e.name);
		if (e.isDirectory()) out.push(...walk(p));
		else if (/\.(ts|svelte)$/.test(e.name)) out.push(p);
	}
	return out;
}

describe('the native shell boundary (record 0010)', () => {
	const files = walk(src)
		.map((p) => ({ path: p.slice(src.length + 1), text: readFileSync(p, 'utf8') }))
		.filter((f) => !f.path.startsWith('lib/native/') && !/\.test\.(ts|svelte)$/.test(f.path));

	it('no file outside lib/native imports @capacitor/* or reads the Capacitor global', () => {
		const offenders = files.filter((f) => /@capacitor\/|\bwindow\.Capacitor\b|\bglobalThis\.Capacitor\b/.test(f.text)).map((f) => f.path);
		expect(offenders).toEqual([]);
	});

	it('no file in lib/native imports a @capacitor package (the plugins are reached through the injected global)', () => {
		const native = walk(join(src, 'lib/native')).map((p) => readFileSync(p, 'utf8'));
		expect(native.filter((t) => /from ['"]@capacitor\//.test(t))).toEqual([]);
	});
});
