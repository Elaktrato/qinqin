// The app-wide hanzi font (#97, design §8): appearance.hanziFont sets one
// stack per script on :root, and every element that carries a study `lang`
// picks its script's stack as --font-hanzi and is set in it.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { hanziStack, installedFaces } from './hanzi';
import { applyHanziVars, hanziVars } from './hanziVars';

const css = readFileSync(join(__dirname, 'hanzi.css'), 'utf8');
const appCss = readFileSync(join(__dirname, '..', '..', 'app.css'), 'utf8');

/** The declarations of the rule whose selector list is exactly `selectors`. */
function rule(selectors: string): string {
	const rules = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^}]*)\}/g)];
	const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
	const hit = rules.find((m) => norm(m[1]) === norm(selectors));
	if (!hit) throw new Error(`no rule for ${selectors}`);
	return norm(hit[2]);
}

afterEach(() => document.documentElement.removeAttribute('style'));

describe('hanziVars', () => {
	it('one stack per script, from the choice and the installed faces', () => {
		const installed = installedFaces([{ face: 'kai', script: 'Hant' }]);
		expect(hanziVars('kai', installed)).toEqual({
			'--font-hanzi-hans': hanziStack('kai', 'zh-Hans', installed),
			'--font-hanzi-hant': hanziStack('kai', 'zh-Hant', installed),
			'--font-hanzi-jpan': hanziStack('kai', 'ja', installed)
		});
		expect(hanziVars('kai', installed)['--font-hanzi-hant']).toMatch(/^"qq-kai-Hant", /);
	});

	it('applyHanziVars sets them on the root', () => {
		const root = document.documentElement;
		applyHanziVars(hanziVars('serif', installedFaces([])), root);
		expect(root.style.getPropertyValue('--font-hanzi-hans')).toContain('"Songti SC"');
		expect(root.style.getPropertyValue('--font-hanzi-jpan')).toContain('"Yu Mincho"');
	});
});

describe('hanzi.css: study text by its lang', () => {
	it('each script picks its stack as --font-hanzi (simplified is the zh default)', () => {
		expect(rule("[lang|='zh']")).toBe('--font-hanzi: var(--font-hanzi-hans);');
		expect(rule("[lang|='zh-Hant'], [lang|='zh-TW'], [lang|='zh-HK'], [lang|='zh-MO'], [lang|='zh-Bopo']")).toBe(
			'--font-hanzi: var(--font-hanzi-hant);'
		);
		expect(rule("[lang|='ja']")).toBe('--font-hanzi: var(--font-hanzi-jpan);');
		// Later rules win at equal specificity: Hant after the zh default.
		expect(css.indexOf("[lang|='zh-Hant']")).toBeGreaterThan(css.indexOf("[lang|='zh'] {"));
	});

	it('elements in body with a hanzi lang are set in it; romanisations and other languages in the interface font', () => {
		expect(rule('body [lang]')).toBe('font-family: var(--font-ui);');
		expect(rule("body [lang|='zh'], body [lang|='ja']")).toBe('font-family: var(--font-hanzi);');
		expect(rule("body [lang|='zh-Latn'], body [lang|='ja-Latn']")).toBe('font-family: var(--font-ui);');
		const order = ['body [lang] {', "body [lang|='zh'], body [lang|='ja'] {", "body [lang|='zh-Latn']"].map((s) => css.indexOf(s));
		expect(order).toEqual([...order].sort((a, b) => a - b));
	});

	it('no font family is named in the stylesheet: the stacks come from hanzi.ts', () => {
		expect(css).not.toMatch(/PingFang|Noto|qq-|url\(/);
	});

	it('app.css carries the one --font-hanzi token (the simplified stack outside study text)', () => {
		expect(appCss.match(/--font-hanzi:[^;]*;/g)).toEqual(['--font-hanzi: var(--font-hanzi-hans, var(--font-ui));']);
	});

	it('the cascade in the DOM: a study lang element gets its script stack', () => {
		const style = document.createElement('style');
		style.textContent = css;
		document.head.append(style);
		document.body.innerHTML = `<p lang="zh-Hant">漢字</p><p lang="zh-TW">漢字</p><p lang="ja">漢字</p><p lang="zh-Latn-pinyin">hàn</p>`;
		const [hant, tw, ja, pinyin] = [...document.body.querySelectorAll('p')].map((p) => getComputedStyle(p));
		expect(hant.getPropertyValue('--font-hanzi').trim()).toBe('var(--font-hanzi-hant)');
		expect(tw.getPropertyValue('--font-hanzi').trim()).toBe('var(--font-hanzi-hant)');
		expect(ja.getPropertyValue('--font-hanzi').trim()).toBe('var(--font-hanzi-jpan)');
		expect(pinyin.getPropertyValue('font-family')).toBe('var(--font-ui)');
		style.remove();
		document.body.innerHTML = '';
	});
});
