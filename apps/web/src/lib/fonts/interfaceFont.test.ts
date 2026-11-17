// The interface font (#97): Figtree, SIL OFL 1.1, bundled unmodified and
// self-hosted. Both files are the upstream ones byte for byte, from
// https://github.com/erikdkennedy/figtree at
// 032dfa7fe219ef3a02890d6d3add84eacc9aebfe:
//   fonts/webfonts/Figtree[wght].woff2 -> src/lib/assets/fonts/Figtree-Variable.woff2
//   OFL.txt                             -> static/FIGTREE-OFL.TXT
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const web = join(__dirname, '..', '..', '..');
const FONT = join(web, 'src', 'lib', 'assets', 'fonts', 'Figtree-Variable.woff2');
const LICENCE = join(web, 'static', 'FIGTREE-OFL.TXT');
const FONT_SHA256 = '6b96ce6d4783658f09e2b92d468da8e542d57aa6e4bc461ab2e7ae71565fdc64';
const LICENCE_SHA256 = '140d37233e7f3ce7313798befa9600893bcceaf41a55fa0fa5ad52f7f657a268';

const sha256 = (data: Buffer): string => createHash('sha256').update(data).digest('hex');
const css = (): string => readFileSync(join(web, 'src', 'app.css'), 'utf8');
/** The declarations of every `@font-face` block. */
const fontFaces = (text: string): string[] => [...text.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => m[1]);
/** The declarations of the first `:root { ... }` block that sets --font-ui. */
const rootWithFontUi = (text: string): string =>
	[...text.matchAll(/:root\s*\{([^}]*)\}/g)].map((m) => m[1]).find((b) => b.includes('--font-ui')) ?? '';

describe('interface font files', () => {
	it('ships the upstream Figtree variable WOFF2 unmodified', () => {
		expect(existsSync(FONT)).toBe(true);
		const data = readFileSync(FONT);
		expect(data.subarray(0, 4).toString('latin1')).toBe('wOF2');
		expect(sha256(data)).toBe(FONT_SHA256);
		expect(data.length).toBeLessThan(40 * 1024);
	});

	it('ships the upstream licence text verbatim (SIL OFL 1.1, no Reserved Font Name)', () => {
		expect(existsSync(LICENCE)).toBe(true);
		const data = readFileSync(LICENCE);
		expect(sha256(data)).toBe(LICENCE_SHA256);
		const text = data.toString('utf8');
		expect(text).toContain('SIL OPEN FONT LICENSE Version 1.1');
		expect(text).toContain('Copyright 2022 The Figtree Project Authors');
		expect(text).not.toMatch(/with Reserved Font Name/);
	});
});

describe('app.css', () => {
	it('declares one self-hosted Figtree face covering every weight', () => {
		const faces = fontFaces(css()).filter((f) => /font-family:\s*'Figtree'/.test(f));
		expect(faces).toHaveLength(1);
		const face = faces[0];
		expect(face).toMatch(/src:\s*url\('\.\/lib\/assets\/fonts\/Figtree-Variable\.woff2'\)\s*format\('woff2'\)\s*;/);
		expect(face).toMatch(/font-weight:\s*300 900\s*;/);
		expect(face).toMatch(/font-style:\s*normal\s*;/);
		expect(face).toMatch(/font-display:\s*swap\s*;/);
	});

	it('sets --font-ui (Figtree, then system faces, then sans-serif) and uses it', () => {
		const root = rootWithFontUi(css());
		const value = root.match(/--font-ui:\s*([^;]+);/)?.[1].trim() ?? '';
		expect(value.startsWith("'Figtree',")).toBe(true);
		expect(value).toContain('system-ui');
		expect(value.endsWith('sans-serif')).toBe(true);
		expect(root).toMatch(/font-family:\s*var\(--font-ui\)\s*;/);
	});
});
