// Unit cases of the opacity lint (opacity.ts). The walk over src/ is in colourWalk.test.ts.
import { describe, expect, it } from 'vitest';
import { opacityFindings } from './opacity';

const svelte = (style: string) => `<p style="opacity: 0.5">x</p>\n<style>\n${style}\n</style>\n`;
const texts = (style: string) => opacityFindings(svelte(style), 'svelte').map((f) => f.text);

describe('opacityFindings', () => {
	it('a rule that fades with opacity below 1 is a finding, named by its selector', () => {
		expect(texts('.hint { color: var(--text); opacity: 0.7; }\n.meta,\n  .note { opacity: .6 }')).toEqual([
			'.hint',
			'.meta, .note'
		]);
	});

	it('opacity 1, 0, a percentage of 100 and a transition of opacity are not', () => {
		expect(
			texts('.a { opacity: 1; } .b { opacity: 0; } .c { opacity: 100%; } .d { transition: opacity 0.2s; }')
		).toEqual([]);
	});

	it('a percentage below 100 is', () => {
		expect(texts('.a { opacity: 60%; }')).toEqual(['.a']);
	});

	it('disabled states are exempt', () => {
		expect(
			texts("button:disabled { opacity: 0.5; } .x[disabled] { opacity: .5 } .y[aria-disabled='true'] { opacity: .5 }")
		).toEqual([]);
	});

	it('a list is exempt only when every selector is a disabled or transition state', () => {
		expect(texts('button:disabled, .faded { opacity: 0.5; }')).toEqual(['button:disabled, .faded']);
	});

	it('keyframes and transition states are exempt', () => {
		expect(
			texts(
				'@keyframes fade { from { opacity: 0.2; } to { opacity: 1; } } .tip.enter { opacity: .3 } [data-state="closing"] { opacity: .5 }'
			)
		).toEqual([]);
	});

	it('inside an at-rule the selector is the inner rule', () => {
		expect(texts('@media (max-width: 40rem) { .hint { opacity: 0.7; } }')).toEqual(['.hint']);
	});

	it('comments are stripped and the line is reported', () => {
		expect(opacityFindings(svelte('/* .a { opacity: 0.5 } */\n.b {\n  opacity: 0.5;\n}'), 'svelte')).toEqual([
			{ line: 5, text: '.b' }
		]);
	});

	it('scans a whole .css file', () => {
		expect(opacityFindings('button.link:disabled { opacity: 0.6 }\n.x { opacity: 0.6 }', 'css')).toEqual([
			{ line: 2, text: '.x' }
		]);
	});

	it('text faded through a transparent colour mix is a finding too', () => {
		expect(
			texts(
				'.meta { color: color-mix(in srgb, currentColor 70%, transparent); }\n' +
					'.x { color: color-mix(in srgb, var(--text) 50%, transparent 50%) }\n' +
					'.ok { color: color-mix(in srgb, var(--accent) 40%, var(--text)); }\n' +
					'.border { border-color: color-mix(in srgb, currentColor 35%, transparent); }\n' +
					'.bg { background: color-mix(in srgb, var(--accent) 14%, transparent); }\n' +
					'.full { color: color-mix(in srgb, currentColor 100%, transparent); }'
			)
		).toEqual(['.meta', '.x']);
	});

	it('a disabled state may fade its colour (WCAG exempts it)', () => {
		expect(texts('button:disabled { color: color-mix(in srgb, currentColor 60%, transparent); }')).toEqual([]);
	});
});
