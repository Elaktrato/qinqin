import { describe, expect, it } from 'vitest';
import { intlFindings, langFindings, markupFindings, tsFindings } from './lint';

// Unit cases of the hard-coded-string heuristic (spec "Lint against new hard-coded strings"). The walk over
// src/ with the allowlist and the pending baseline is hardcoded.test.ts.
const texts = (f: { text: string }[]) => f.map((x) => x.text);

describe('markupFindings', () => {
	it('finds text nodes with two or more letters, script and style stripped', () => {
		const src = `<script lang="ts">const a = 'Hidden sentence here';</script>
<p>Save changes</p><span>·</span><b>x</b>
<style>p::after { content: 'Not markup text'; }</style>`;
		expect(texts(markupFindings(src))).toEqual(['Save changes']);
	});

	it('joins a text run across inline expressions and splits at blocks and tags', () => {
		const src = `<p>You have {count} cards due</p>{#if a > b}<em>Done</em>{:else}Later on{/if}`;
		expect(texts(markupFindings(src))).toEqual(['You have {…} cards due', 'Done', 'Later on']);
	});

	it('finds the five attributes with literal values, not other attributes', () => {
		const src = `<button aria-label="Close dialog" class="big red" data-x="Some words" title="Help {name}">x</button>
<input placeholder="Search" /><img alt="Logo" src="a.png" /><Field label="Name" value="Fixed text" />`;
		expect(texts(markupFindings(src))).toEqual(['Close dialog', 'Help {…}', 'Search', 'Logo', 'Name']);
	});

	it('finds string literals in those attributes when the value is an expression, but not catalogue keys', () => {
		const src = `<button aria-label={open ? 'Hide' : 'Show'} title={t('common.action.close')} onclick={() => a > b}>{t('app.name')}</button>`;
		expect(texts(markupFindings(src))).toEqual(['Hide', 'Show']);
	});

	it('finds sentence literals inside markup expressions', () => {
		const src = `<p>{busy ? 'Saving your changes' : name}</p><p>{'Hello there'}</p>`;
		expect(texts(markupFindings(src))).toEqual(['Saving your changes', 'Hello there']);
	});

	it('ignores comments, entities and single letters, and reports the line', () => {
		const src = `<!-- A comment here -->\n<p>&nbsp;</p>\n<p>&amp; ok</p>`;
		const f = markupFindings(src);
		expect(texts(f)).toEqual(['& ok']);
		expect(f[0].line).toBe(3);
	});

	it('counts CJK letters as letters (allowlisted where deliberate)', () => {
		expect(texts(markupFindings('<span lang="zh">勤勤</span>'))).toEqual(['勤勤']);
	});
});

describe('tsFindings', () => {
	it('finds sentence-like literals: capital first, a space, two or more words', () => {
		const src = `const a = 'Save changes'; const b = "lowercase words here"; const c = 'Single';
const d = \`Took \${n} minutes\`; const e = 'x.y.z';`;
		expect(texts(tsFindings(src, false))).toEqual(['Save changes', 'Took {…} minutes']);
	});

	it('finds placeholder-led word templates (hand-rolled plurals, message tables)', () => {
		const src = `const a = \`\${n} minute\${n === 1 ? '' : 's'}\`; const b = '{n} reviews'; const c = \`\${w}px\`;`;
		expect(texts(tsFindings(src, false))).toEqual(['{…} minute{…}', '{n} reviews']);
	});

	it('exempts Error and console arguments and comments', () => {
		const src = `// A comment sentence here
/* Another comment here */
throw new Error('A page does not match');
console.warn('Something went odd');
class PartialError extends Error {}
const x = new TypeError(\`Bad value \${v}\`);`;
		expect(tsFindings(src, false)).toEqual([]);
	});

	it('survives regex literals with quotes', () => {
		const src = `const re = /["']/g; const s = 'Real sentence here';`;
		expect(texts(tsFindings(src, false))).toEqual(['Real sentence here']);
	});

	it('only looks into <script> blocks of a .svelte file', () => {
		const src = `<script>const s = 'Script sentence here';</script><p>Markup text</p>`;
		expect(texts(tsFindings(src, true))).toEqual(['Script sentence here']);
	});
});

describe('intlFindings and langFindings', () => {
	it('finds fixed-locale formatting calls', () => {
		const src = `new Intl.DateTimeFormat('en-GB'); n.toLocaleString('en'); d.toLocaleDateString();
new Intl.PluralRules('en'); Intl.supportedValuesOf('timeZone');`;
		expect(texts(intlFindings(src))).toEqual([
			'Intl.DateTimeFormat(',
			'toLocaleString(',
			'toLocaleDateString(',
			'Intl.PluralRules('
		]);
	});

	it('finds literal lang attributes in markup, not expressions or script', () => {
		const src = `<script lang="ts">let a = 1;</script><span lang="zh">勤</span><span lang={studyLang(x)}>x</span>`;
		expect(texts(langFindings(src))).toEqual(['lang="zh"']);
	});
});
