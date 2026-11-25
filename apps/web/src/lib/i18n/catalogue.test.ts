import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import retired from '../../../../../docs/contracts/i18n/retired-keys.json';
import { KEY_AREAS, keyProblem } from './keys';
import { callSiteProblems, literalKeys, parityProblems } from './catalogueCheck';
import { parseMessage } from './message';

// The catalogue checks (spec "Catalogue tests"): key scheme and area list, every message parses, sorted keys,
// no retired key, non-en parity, every en key used as a literal in non-test src/, every literal key exists,
// call-site arguments match, no dynamic keys.

const src = resolve(__dirname, '../..');
const dir = resolve(__dirname, 'messages');
const readJson = (p: string): Record<string, string> => JSON.parse(readFileSync(p, 'utf8'));
const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
const en = readJson(join(dir, 'en.json'));
const notes = readJson(join(dir, 'notes.json'));
const languages = files.filter((f) => f !== 'notes.json').map((f) => f.replace(/\.json$/, ''));

function walk(d: string): string[] {
	const out: string[] = [];
	for (const e of readdirSync(d, { withFileTypes: true })) {
		const p = join(d, e.name);
		if (e.isDirectory()) out.push(...walk(p));
		else if (/\.(svelte|ts)$/.test(e.name) && !/\.test\.(ts|svelte)$/.test(e.name)) out.push(p);
	}
	return out;
}
/** The runtime and its checks document keys in comments and messages; they use none. */
const RUNTIME = ['lib/i18n/index.ts', 'lib/ui/Msg.svelte', 'lib/i18n/catalogueCheck.ts', 'lib/i18n/lint.ts'];
const sources = walk(src)
	.map((p) => ({ path: p.slice(src.length + 1), text: readFileSync(p, 'utf8') }))
	.filter((s) => !RUNTIME.includes(s.path));

describe('key scheme', () => {
	it('the README lists exactly the key areas', () => {
		const readme = readFileSync(resolve(src, '../../../docs/contracts/i18n/README.md'), 'utf8');
		const block = readme.slice(readme.indexOf('<!-- areas:start -->'), readme.indexOf('<!-- areas:end -->'));
		expect([...block.matchAll(/`([a-zA-Z]+)`/g)].map((m) => m[1])).toEqual([...KEY_AREAS]);
	});

	it('keyProblem accepts the scheme and names what is wrong', () => {
		expect(keyProblem('settings.account.interfaceLanguage.label')).toBeNull();
		expect(keyProblem('app.name')).toBeNull();
		expect(keyProblem('app')).toBe('segments');
		expect(keyProblem('app.a.b.c.d.e.f')).toBe('segments');
		expect(keyProblem('app.snake_case')).toBe('segment');
		expect(keyProblem('app.kebab-case')).toBe('segment');
		expect(keyProblem('app.1st')).toBe('segment');
		expect(keyProblem('App.name')).toBe('segment');
		expect(keyProblem('unknown.name')).toBe('area');
		expect(keyProblem(`app.${'a'.repeat(120)}`)).toBe('length');
	});
});

describe.each(languages)('messages/%s.json', (lang) => {
	const raw = readFileSync(join(dir, `${lang}.json`), 'utf8');
	const catalogue = readJson(join(dir, `${lang}.json`));

	it('is a flat object of strings with sorted keys', () => {
		const keys = Object.keys(catalogue);
		expect(keys).toEqual([...keys].sort());
		for (const v of Object.values(catalogue)) expect(typeof v).toBe('string');
		expect(raw.endsWith('\n')).toBe(true);
	});

	it('every key matches the scheme', () => {
		expect(Object.keys(catalogue).filter((k) => keyProblem(k) !== null)).toEqual([]);
	});

	it('every message parses', () => {
		const bad = Object.entries(catalogue).flatMap(([k, m]) => {
			try {
				parseMessage(m);
				return [];
			} catch (e) {
				return [`${k}: ${(e as Error).message}`];
			}
		});
		expect(bad).toEqual([]);
	});

	it('holds no retired key', () => {
		expect(Object.keys(catalogue).filter((k) => (retired.keys as string[]).includes(k))).toEqual([]);
	});

	it.runIf(lang !== 'en')('matches en: keys, arguments, tags, plural categories', () => {
		expect(parityProblems(lang, catalogue, en)).toEqual([]);
	});
});

describe('notes.json', () => {
	it('notes only keys of en, sorted', () => {
		expect(Object.keys(notes).filter((k) => !(k in en))).toEqual([]);
		expect(Object.keys(notes)).toEqual(Object.keys(notes).sort());
	});
});

describe('parityProblems (a test-only translation)', () => {
	const base = {
		'app.name': 'qinqin',
		'study.due': '{count, plural, one {# card due} other {# cards due}}',
		'sources.intro': 'Read <link>this</link>, {name}'
	};
	it('a faithful translation has no problems', () => {
		expect(
			parityProblems(
				'ru',
				{
					'study.due': '{count, plural, one {# карточка} few {# карточки} many {# карточек} other {# карточки}}',
					'sources.intro': '{name}, <link>прочтите</link>'
				},
				base
			)
		).toEqual([]);
	});
	it('names each kind of drift', () => {
		expect(
			parityProblems(
				'ru',
				{
					'app.extra': 'x',
					'study.due': '{count, plural, one {# карточка} other {# карточки}}',
					'sources.intro': 'Read <b>this</b>, {nom}'
				},
				base
			)
		).toEqual([
			'app.extra: not in en',
			'sources.intro: arguments name != nom',
			'sources.intro: tags link != b',
			'study.due: plural categories few,many,one,other != one,other'
		]);
		expect(parityProblems('ja', { 'study.due': 'カード {count} 枚' }, base)).toEqual([
			'study.due: plural in en, not here'
		]);
		expect(parityProblems('ja', { 'app.name': '{x, plural, other {#}}' }, base)).toEqual([
			'app.name: arguments  != x',
			'app.name: plural here, not in en'
		]);
		expect(parityProblems('ja', { 'app.name': 'a {' }, base)).toEqual(['app.name: does not parse (unbalanced)']);
	});
});

describe('usage in src/', () => {
	const literals = literalKeys(sources.map((s) => s.text).join('\n'));
	it('finds the sources', () => {
		expect(sources.length).toBeGreaterThan(300);
	});
	it('every en key is used as a literal in non-test src/', () => {
		expect(Object.keys(en).filter((k) => !literals.has(k))).toEqual([]);
	});
	it('every literal key and its arguments match en; no dynamic keys', () => {
		expect(sources.flatMap((s) => callSiteProblems(s.path, s.text, en))).toEqual([]);
	});
});

describe('callSiteProblems', () => {
	const cat = { 'app.name': 'qinqin', 'study.due': '{count, plural, one {# card} other {# cards}}', 'a.b': 'Hi {name} {x}' };
	it('accepts matching calls and calls it cannot parse', () => {
		const text = `t('app.name'); t("study.due", { count: n }); t('a.b', { name, x: 1 }); t('a.b', args); t(KEYS[k]);
<Msg key="a.b" args={{ name: 'n', x }} /> tParts('app.name')`;
		expect(callSiteProblems('f.ts', text, cat)).toEqual([]);
	});
	it('names unknown keys, argument drift and dynamic keys', () => {
		const text = `t('app.nope'); t('study.due'); t('a.b', { name: 1 }); t('app.name', { x: 1 });
t(\`study.\${k}\`); <Msg key={\`a.\${b}\`} /> <Msg key="a.b" args={{ name, x, y }} />`;
		expect(callSiteProblems('f.ts', text, cat)).toEqual([
			'f.ts:1: unknown key app.nope',
			'f.ts:1: study.due arguments  != count',
			'f.ts:1: a.b arguments name != name,x',
			'f.ts:1: app.name arguments x != ',
			'f.ts:2: dynamic key',
			'f.ts:2: dynamic key',
			'f.ts:2: a.b arguments name,x,y != name,x'
		]);
	});
	it('literalKeys collects every quoted string', () => {
		expect([...literalKeys(`const M = { a: 'study.due', b: "app.name" }; x(\`a.b\`)`)].sort()).toEqual([
			'a.b',
			'app.name',
			'study.due'
		]);
	});
});
