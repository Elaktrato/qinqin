import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { goto } = vi.hoisted(() => ({ goto: vi.fn() }));
vi.mock('$app/navigation', () => ({ goto }));

import svgFixture from '../../../../../docs/contracts/images/svg.json';
import { entryPicture, imagePacks, pictureCreditLine, safeSvg, themeSvg, type EntryPicture } from './images';

const APPLE =
	'<svg id="emoji" viewBox="0 0 72 72" xmlns="http://www.w3.org/2000/svg"><g id="line"><path fill="none" stroke="#000" stroke-width="2" d="M1 2h3"/><path fill="#000000" d="M0 0"/><circle style="fill:#000;stroke:black" r="2"/><rect fill="#abda4d" width="1" height="1"/></g></svg>';

const picture = (over: Partial<EntryPicture> = {}): EntryPicture => ({
	packId: 'images-openmoji',
	concept: '1F34E',
	label: 'red apple',
	credit: 'OpenMoji, Liz Bravo',
	license: 'CC BY-SA 4.0',
	attribution: 'All emojis designed by OpenMoji',
	basis: 'manual',
	sense: 0,
	score: 100,
	svg: APPLE,
	...over
});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('images api client', () => {
	beforeEach(() => {
		vi.stubGlobal('localStorage', { getItem: (k: string) => (k === 'qinqin.token' ? 'tok' : null) });
		vi.stubGlobal('fetch', vi.fn());
	});
	afterEach(() => vi.unstubAllGlobals());

	it('entryPicture asks for the entry, signed in, and returns the picture', async () => {
		vi.mocked(fetch).mockImplementation(async () => json({ picture: picture() }));
		const p = await entryPicture(42);
		expect(p?.concept).toBe('1F34E');
		expect(p?.svg).toBe(APPLE);
		const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
		expect(url).toBe('/api/images/entries/42');
		expect(new Headers(init.headers).get('authorization')).toBe('Bearer tok');
	});

	it('passes the sense along, only when it is a positive number', async () => {
		vi.mocked(fetch).mockImplementation(async () => json({ picture: null }));
		await entryPicture(7, { sense: 3 });
		await entryPicture(7, { sense: 0 });
		await entryPicture(7, {});
		expect(vi.mocked(fetch).mock.calls.map((c) => c[0])).toEqual(['/api/images/entries/7?sense=3', '/api/images/entries/7', '/api/images/entries/7']);
	});

	it('answers null when no pack maps the entry', async () => {
		vi.mocked(fetch).mockImplementation(async () => json({ picture: null }));
		expect(await entryPicture(1)).toBeNull();
	});

	it('answers null for a picture that is not a plain SVG', async () => {
		vi.mocked(fetch).mockImplementation(async () => json({ picture: picture({ svg: '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>' }) }));
		expect(await entryPicture(1)).toBeNull();
	});

	it('rejects on a server error: a caller that only decorates catches it', async () => {
		vi.mocked(fetch).mockImplementation(async () => json({ error: 'internal', message: 'x' }, 500));
		await expect(entryPicture(1)).rejects.toMatchObject({ status: 500 });
	});

	it('imagePacks is public: no credentials are sent', async () => {
		vi.mocked(fetch).mockImplementation(async () => json([{ packId: 'images-openmoji', name: 'OpenMoji', version: '17.0.0', languages: ['ja', 'zh'], license: 'CC BY-SA 4.0', attribution: 'x', pictureCount: 1, mappingCount: 2 }]));
		const list = await imagePacks();
		expect(list[0].packId).toBe('images-openmoji');
		const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
		expect(url).toBe('/api/image-packs');
		expect(new Headers(init?.headers).get('authorization')).toBeNull();
	});
});

describe('themeSvg', () => {
	it('turns black fills, strokes and style declarations into currentColor and leaves other colours', () => {
		const out = themeSvg(APPLE);
		expect(out).toContain('stroke="currentColor"');
		expect(out).toContain('fill="currentColor"');
		expect(out).toContain('style="fill:currentColor;stroke:currentColor"');
		expect(out).toContain('fill="#abda4d"');
		expect(out).toContain('fill="none"');
		expect(out).not.toMatch(/#000|black/);
	});

	it('does not touch a colour that only starts like black', () => {
		const svg = '<svg><path fill="#0a0a0a"/><path style="fill:#000fff"/></svg>';
		expect(themeSvg(svg)).toBe(svg);
	});
});

describe('safeSvg', () => {
	it('accepts a plain drawing, with or without an XML header', () => {
		expect(safeSvg(APPLE)).toBe(APPLE);
		expect(safeSvg('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><use href="#a"/></svg>')).not.toBeNull();
	});

	it('refuses what can run code or load something', () => {
		for (const svg of [
			'<svg><script>x</script></svg>',
			'<svg><foreignObject/></svg>',
			'<svg><path onload="x()"/></svg>',
			'<svg><a href="https://example.test"/></svg>',
			'<svg><use href="https://example.test/a.svg#b"/></svg>',
			'<svg><image href="data:image/png;base64,AA"/></svg>',
			'<svg><style>a{}</style></svg>',
			'<html></html>',
			null,
			42
		]) {
			expect(safeSvg(svg), String(svg)).toBeNull();
		}
	});
});

describe('pictureCreditLine', () => {
	it('names the designer and the licence', () => {
		expect(pictureCreditLine(picture())).toBe('OpenMoji, Liz Bravo, CC BY-SA 4.0');
	});
});

// docs/contracts/images/svg.json: the vocabulary every client agrees on.
describe('images/svg contract', () => {
	it.each(svgFixture.valid)('safeSvg accepts: $name', (c) => {
		expect(safeSvg(c.svg)).toBe(c.svg);
	});
	it.each(svgFixture.invalid.filter((c) => c.client))('safeSvg refuses: $name', (c) => {
		expect(safeSvg(c.svg)).toBeNull();
	});
	it.each(svgFixture.theme)('themeSvg: $name', (c) => {
		expect(themeSvg(c.input)).toBe(c.output);
	});
});
