// Guard for record 0004 (docs/architecture/0004-web-folder-rules.md): the folder rules of apps/web/src/lib,
// checked on the real tree, and each check shown to fail on a small planted tree.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	LOGIC_FOLDERS,
	LOOSE_ALLOWED,
	duplicateNameFindings,
	logicFolderFindings,
	looseFileFindings,
	sharedComponentFindings,
	uiImportFindings,
	unmappedRouteFindings,
	type SourceFile
} from './folderRules';

const src = resolve(__dirname, '../../src');

function sources(): SourceFile[] {
	const out: SourceFile[] = [];
	const walk = (d: string): void => {
		for (const e of readdirSync(d, { withFileTypes: true })) {
			const p = join(d, e.name);
			if (e.isDirectory()) walk(p);
			else {
				const text = /\.(ts|js|svelte)$/.test(e.name) ? readFileSync(p, 'utf8') : '';
				out.push({ path: relative(src, p).split('\\').join('/'), text });
			}
		}
	};
	walk(src);
	return out;
}

const tree = sources();
const file = (path: string, text = ''): SourceFile => ({ path, text });
const imp = (spec: string): string => `<script lang="ts">import X from '${spec}';</script>`;

describe('the web folder rules hold on apps/web/src', () => {
	it('lib/ui imports nothing but lib/ui, lib/i18n and lib/theme', () => {
		expect(uiImportFindings(tree)).toEqual([]);
	});

	it('every file in lib/components is used by two or more features', () => {
		expect(sharedComponentFindings(tree)).toEqual([]);
	});

	it('no component sits in a logic-only folder', () => {
		expect(logicFolderFindings(tree)).toEqual([]);
	});

	it('component file names are unique across lib', () => {
		expect(duplicateNameFindings(tree)).toEqual([]);
	});

	it('no loose file sits at the top of lib', () => {
		expect(looseFileFindings(tree)).toEqual([]);
	});

	it('every route folder counts as a feature', () => {
		expect(unmappedRouteFindings(tree)).toEqual([]);
	});

	it('names only folders and allowed files that exist', () => {
		const tops = new Set(tree.filter((f) => f.path.startsWith('lib/')).map((f) => f.path.split('/')[1]));
		for (const d of LOGIC_FOLDERS) expect(tops.has(d), d).toBe(true);
		for (const name of Object.keys(LOOSE_ALLOWED)) expect(tops.has(name), name).toBe(true);
	});
});

describe('each check fails on a planted violation', () => {
	it('lib/ui importing a feature, lib/components or a domain module', () => {
		const planted = [
			file('lib/ui/Button.svelte', imp('$lib/features/reader/BookView.svelte')),
			file('lib/ui/Chip.svelte', imp('../components/Flag.svelte')),
			file('lib/ui/menu.ts', "import { api } from '$lib/api/client';\nimport { t } from '$lib/i18n';"),
			file('lib/ui/testing/Gallery.svelte', imp('$lib/components/Flag.svelte')),
			file('lib/features/reader/BookView.svelte'),
			file('lib/components/Flag.svelte'),
			file('lib/api/client.ts'),
			file('lib/i18n/index.ts')
		];
		expect(uiImportFindings(planted)).toEqual([
			'lib/ui/Button.svelte imports lib/features/reader/BookView.svelte',
			'lib/ui/Chip.svelte imports lib/components/Flag.svelte',
			'lib/ui/menu.ts imports lib/api/client.ts'
		]);
	});

	it('a file in lib/components used by one feature (a route counts as its feature; tests do not count)', () => {
		const planted = [
			file('lib/components/Shared.svelte'),
			file('lib/components/Single.svelte'),
			file('lib/components/Unused.ts'),
			file('lib/components/Single.dom.test.ts', imp('./Unused')),
			file('lib/entry/EntryView.svelte', imp('$lib/components/Shared.svelte') + imp('$lib/components/Single.svelte')),
			file('routes/entry/[id]/+page.svelte', imp('$lib/components/Single.svelte')),
			file('routes/study/+page.svelte', imp('$lib/components/Shared.svelte'))
		];
		expect(sharedComponentFindings(planted)).toEqual([
			'lib/components/Single.svelte is used by only entry',
			'lib/components/Unused.ts is used by no feature'
		]);
	});

	it('a component in a logic-only folder (a test stub is fine)', () => {
		const planted = [
			file('lib/study/DeckCardTypes.svelte'),
			file('lib/i18n/PseudoStub.test.svelte'),
			file('lib/entry/EntryView.svelte')
		];
		expect(logicFolderFindings(planted)).toEqual([
			'lib/study/DeckCardTypes.svelte is a component in the logic folder lib/study'
		]);
	});

	it('two components with one file name', () => {
		const planted = [
			file('lib/components/EntryEditor.svelte'),
			file('lib/features/journal/EntryEditor.svelte'),
			file('lib/features/grammar/EmptyStub.test.svelte'),
			file('lib/features/journal/EmptyStub.test.svelte')
		];
		expect(duplicateNameFindings(planted)).toEqual([
			'EntryEditor.svelte: lib/components/EntryEditor.svelte, lib/features/journal/EntryEditor.svelte'
		]);
	});

	it('a loose module at the top of lib', () => {
		expect(looseFileFindings([file('lib/listbox.ts'), file('lib/ui/index.ts')])).toEqual([
			'lib/listbox.ts is a loose file at the top of lib/'
		]);
	});

	it('a route folder with no feature', () => {
		expect(unmappedRouteFindings([file('routes/quiz/+page.svelte'), file('routes/home.dom.test.ts')])).toEqual([
			'routes/quiz has no feature in ROUTE_FEATURES'
		]);
	});
});
