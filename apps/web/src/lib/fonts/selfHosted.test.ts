// Fonts are self-hosted (#97, design §8): nothing in the app or its build asks a
// third-party host for a font, and the interface font is a precached shell file,
// so it works offline from the first visit.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { classify } from '../pwa/sw/classify';

const web = join(__dirname, '..', '..', '..');
const build = join(web, 'build');

/** Web-font services. (General CDNs are caught by FONT_URL when they would serve a font.) */
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com', 'use.typekit.net', 'p.typekit.net', 'fonts.bunny.net', 'fontlibrary.org'];
/** An absolute or protocol-relative URL of a font file, on any host. */
const FONT_URL = /(?:[a-z][a-z0-9+.-]*:)?\/\/[^\s"'`()]+\.(?:woff2?|ttf|otf|eot)\b/gi;
const TEXT = /\.(css|svelte|ts|js|mjs|html|json|webmanifest|svg)$/;

function walk(dir: string): string[] {
	const out: string[] = [];
	for (const e of readdirSync(dir, { withFileTypes: true })) {
		const p = join(dir, e.name);
		if (e.isDirectory()) out.push(...walk(p));
		else out.push(p);
	}
	return out;
}

/** The URLs of every `url(...)` and `@import "..."` in a stylesheet (or a style block). */
function cssUrls(text: string): string[] {
	const urls = [...text.matchAll(/url\(\s*(['"]?)([^'")]*)\1\s*\)/g)].map((m) => m[2]);
	const imports = [...text.matchAll(/@import\s+(['"])([^'"]+)\1/g)].map((m) => m[2]);
	return [...urls, ...imports];
}

/** Same-origin: relative, root-relative or an inline data URL; never a scheme or `//host`. */
const sameOrigin = (url: string): boolean => url.startsWith('data:') || !/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(url);

/** Problems in one text file: a font service or an off-origin font URL named, or a stylesheet URL leaving the origin. */
function problems(file: string, text: string): string[] {
	const rel = relative(web, file);
	const out = FONT_HOSTS.filter((h) => text.includes(h)).map((h) => `${rel}: names ${h}`);
	for (const [url] of text.matchAll(FONT_URL)) out.push(`${rel}: font URL ${url}`);
	if (/\.(css|svelte|html)$/.test(file)) {
		for (const url of cssUrls(text)) if (!sameOrigin(url)) out.push(`${rel}: stylesheet URL ${url}`);
	}
	return out;
}

describe('fonts come from this app only', () => {
	it('no source or static file names a font host or points a stylesheet off-origin', () => {
		const files = [...walk(join(web, 'src')), ...walk(join(web, 'static'))].filter(
			(f) => TEXT.test(f) && !/\.test\.(ts|js)$/.test(f)
		);
		expect(files.length).toBeGreaterThan(300);
		expect(files.flatMap((f) => problems(f, readFileSync(f, 'utf8')))).toEqual([]);
	});

	it('the stylesheet check catches an off-origin font (guard of the guard)', () => {
		const css = "@font-face { src: url('https://example.org/a.woff2') format('woff2'); }";
		expect(problems(join(web, 'src', 'x.css'), css)).toEqual([
			'src/x.css: font URL https://example.org/a.woff2',
			'src/x.css: stylesheet URL https://example.org/a.woff2'
		]);
		expect(problems(join(web, 'src', 'v.css'), "@font-face { src: url('https://example.org/a.css'); }")).toEqual([
			'src/v.css: stylesheet URL https://example.org/a.css'
		]);
		expect(problems(join(web, 'src', 'y.css'), '@import "//fonts.example/x.css";')).toEqual([
			'src/y.css: stylesheet URL //fonts.example/x.css'
		]);
		expect(problems(join(web, 'src', 'z.svelte'), '<link href="https://fonts.googleapis.com/css2">')).toEqual([
			'src/z.svelte: names fonts.googleapis.com'
		]);
		expect(problems(join(web, 'src', 'w.ts'), "new FontFace('x', 'url(https://cdn.example/f.ttf)')")).toEqual([
			'src/w.ts: font URL https://cdn.example/f.ttf'
		]);
	});

	// Runs over the output of `npm run build` (skipped when there is none).
	describe.skipIf(!existsSync(build))('the build output', () => {
		const files = existsSync(build) ? walk(build) : [];
		const rootPath = (f: string): string => '/' + relative(build, f).split('\\').join('/');

		it('emits the interface font once, as a hashed immutable asset', () => {
			const fonts = files.filter((f) => /\.(woff2?|ttf|otf)$/i.test(f)).map(rootPath);
			expect(fonts).toHaveLength(1);
			// Vite keeps the source name before the content hash.
			expect(fonts[0]).toMatch(/^\/_app\/immutable\/assets\/Figtree-Variable\.[A-Za-z0-9_-]+\.woff2$/);
		});

		it('names no font host and keeps every stylesheet URL on this origin', () => {
			const texts = files.filter((f) => TEXT.test(f));
			expect(texts.some((f) => f.endsWith('.css'))).toBe(true);
			expect(texts.flatMap((f) => problems(f, readFileSync(f, 'utf8')))).toEqual([]);
		});

		it('the service worker treats the font as a precached shell file', () => {
			// `$service-worker`'s build list is the files under /_app/ (the hashed bundle);
			// the worker precaches it at install and serves `shell` cache-first.
			const shellUrls = new Set(files.map(rootPath).filter((p) => p.startsWith('/_app/')));
			const font = [...shellUrls].find((p) => p.endsWith('.woff2'))!;
			expect(font).toBeDefined();
			const origin = 'https://qinqin.example';
			const req = { method: 'GET', url: origin + font, mode: 'cors', headers: { get: () => null } };
			expect(classify(req, { origin, shellUrls })).toBe('shell');
			// The built worker carries the font in its precache list.
			const worker = readFileSync(join(build, 'service-worker.js'), 'utf8');
			expect(worker).toContain(font.slice(1));
		});
	});
});
