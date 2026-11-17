// Unit cases of the colour lint (colours.ts). The walk over src/ is colourWalk.test.ts.
import { describe, expect, it } from 'vitest';
import { colourFindings } from './colours';

const svelte = (style: string, markup = '<p>x</p>') =>
	`<script>let a = '#fff';</script>\n${markup}\n<style>\n${style}\n</style>\n`;
const texts = (src: string, kind: 'svelte' | 'css' = 'svelte') => colourFindings(src, kind).map((f) => f.text);

describe('colourFindings', () => {
	it('finds hex literals of every length in values', () => {
		expect(
			texts(svelte('a { color: #fff; border-color: #ffff; background: #0b6bcb; outline-color: #0b6bcb80; }'))
		).toEqual(['#fff', '#ffff', '#0b6bcb', '#0b6bcb80']);
	});

	it('finds the colour functions', () => {
		const fns = [
			'rgb(0 0 0)',
			'rgba(0,0,0,.1)',
			'hsl(0 0% 0%)',
			'hsla(0,0%,0%,1)',
			'hwb(0 0% 0%)',
			'lab(0 0 0)',
			'lch(0 0 0)',
			'oklab(0 0 0)',
			'oklch(0 0 0)',
			'color(srgb 0 0 0)'
		];
		const found = texts(svelte(fns.map((f, i) => `.c${i} { color: ${f}; }`).join('\n')));
		expect(found).toEqual(['rgb(', 'rgba(', 'hsl(', 'hsla(', 'hwb(', 'lab(', 'lch(', 'oklab(', 'oklch(', 'color(']);
	});

	it('finds named colours but not transparent, currentColor or inherit', () => {
		expect(
			texts(
				svelte('a { color: white; background: transparent; border-color: currentColor; fill: inherit; stroke: Red; }')
			)
		).toEqual(['white', 'Red']);
	});

	it('allows the system colours only inside forced-colors blocks', () => {
		const style =
			'a { color: CanvasText; }\n@media (forced-colors: active) { a { color: CanvasText; border-color: ButtonText; } }';
		expect(texts(svelte(style))).toEqual(['CanvasText']);
	});

	it('finds prefers-color-scheme anywhere in a style', () => {
		expect(texts(svelte('@media (prefers-color-scheme: dark) { a { color: var(--text); } }'))).toEqual([
			'prefers-color-scheme'
		]);
	});

	it('a selector #id is not a colour; only values count', () => {
		expect(texts(svelte('#abc, a:hover #fade { color: var(--text); }'))).toEqual([]);
	});

	it('an href="#top" is not in a style and the script is not scanned', () => {
		expect(texts(svelte('a { color: var(--text); }', '<a href="#top">top</a><p class="red">x</p>'))).toEqual([]);
	});

	it('url(#gradient) is not a colour', () => {
		expect(texts(svelte('a { fill: url(#beaded); mask: url(#fade); }'))).toEqual([]);
	});

	it('var(--x, #fff) is a finding', () => {
		expect(texts(svelte('a { color: var(--x, #fff); }'))).toEqual(['#fff']);
	});

	it('comments are stripped', () => {
		expect(texts(svelte('/* was #0b6bcb, white */ a { color: var(--text); } // not css'))).toEqual([]);
	});

	it('reports the line of each finding', () => {
		const src = svelte('a {\n  color: var(--text);\n  background: #fff;\n}');
		expect(colourFindings(src, 'svelte')).toEqual([{ line: 6, text: '#fff' }]);
	});

	it('scans style= and style: attribute values, not their expressions', () => {
		const markup =
			'<p style="color: #123456; width: {w}px">a</p><p style:background="red">b</p><p style:color={theme.colors.panel}>c</p><p style:color={on ? \'#abcdef\' : \'var(--text)\'}>d</p>';
		expect(texts(svelte('a { color: var(--text); }', markup))).toEqual(['#123456', 'red', '#abcdef']);
	});

	it('scans the colour presentation attributes of markup', () => {
		const markup =
			'<svg><rect fill="#fff" /><path stroke="black" /><rect fill="none" stroke="currentColor" /><stop stop-color="#000" /></svg>';
		expect(texts(svelte('a { color: var(--text); }', markup))).toEqual(['#fff', 'black', '#000']);
	});

	it('scans a whole .css file', () => {
		expect(texts('body { background: var(--panel, Canvas); }\n.x { color: #000; }', 'css')).toEqual(['Canvas', '#000']);
	});
});
