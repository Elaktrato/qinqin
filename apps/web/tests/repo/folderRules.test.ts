// Guard for record 0004 (docs/architecture/0004-web-folder-rules.md): the folder rules of apps/web/src/lib,
// checked on the real tree, and each check shown to fail on a small planted tree.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	FEATURE_FOLDERS,
	LOGIC_FOLDERS,
	LOOSE_ALLOWED,
	STRUCTURE_FOLDERS,
	STUDY_CORE_FOLDERS,
	duplicateNameFindings,
	isTestOnly,
	logicFolderFindings,
	looseFileFindings,
	sharedComponentFindings,
	studyCoreImportFindings,
	uiImportFindings,
	unclassifiedFolderFindings,
	unmappedRouteFindings,
	unresolvedImportFindings,
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

	it('every import of a shipped file resolves', () => {
		expect(unresolvedImportFindings(tree)).toEqual([]);
	});

	it('the study core, the exercises and the courses feature never import the flashcards feature', () => {
		expect(studyCoreImportFindings(tree)).toEqual([]);
	});

	it('the study core folders are logic folders', () => {
		for (const d of STUDY_CORE_FOLDERS) expect(LOGIC_FOLDERS, d).toContain(d);
	});

	it('every top folder of lib is classified', () => {
		expect(unclassifiedFolderFindings(tree)).toEqual([]);
	});

	it('names only folders and allowed files that exist, each in one class', () => {
		const tops = new Set(tree.filter((f) => f.path.startsWith('lib/')).map((f) => f.path.split('/')[1]));
		const classes = [...LOGIC_FOLDERS, ...FEATURE_FOLDERS, ...STRUCTURE_FOLDERS];
		for (const d of classes) expect(tops.has(d), d).toBe(true);
		expect(new Set(classes).size).toBe(classes.length);
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
			file('lib/ui/Tabs.svelte', "<script>const m = import(`$lib/api/client`); import x from '$lib/api/client.js';</script>"),
			file('lib/ui/Sheet.svelte', "<script>// import X from '$lib/api/client';\n/* import Y from '$lib/api/client'; */</script>"),
			file('lib/features/reader/BookView.svelte'),
			file('lib/components/Flag.svelte'),
			file('lib/api/client.ts'),
			file('lib/i18n/index.ts')
		];
		expect(uiImportFindings(planted)).toEqual([
			'lib/ui/Button.svelte imports lib/features/reader/BookView.svelte',
			'lib/ui/Chip.svelte imports lib/components/Flag.svelte',
			'lib/ui/menu.ts imports lib/api/client.ts',
			'lib/ui/Tabs.svelte imports lib/api/client.ts',
			'lib/ui/Tabs.svelte imports lib/api/client.ts'
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

	it('only features count as users: not logic folders, ui, lib/features itself, root files, logic routes or comments', () => {
		const planted = [
			file('lib/components/Lonely.svelte'),
			file('lib/entry/Use.svelte', imp('$lib/components/Lonely.svelte')),
			file('lib/features/journal/Note.svelte', "<script>// import L from '$lib/components/Lonely.svelte'\n</script>"),
			file('lib/studycore/reexport.ts', "export { default as L } from '$lib/components/Lonely.svelte';"),
			file('lib/ui/Chip.svelte', imp('$lib/components/Lonely.svelte')),
			file('lib/features/index.ts', "import '$lib/components/Lonely.svelte';"),
			file('lib/features/FeaturePage.svelte', imp('$lib/components/Lonely.svelte')),
			file('hooks.client.ts', "import '$lib/components/Lonely.svelte';"),
			file('routes/p/[plugin]/+page.ts', "import '$lib/components/Lonely.svelte';"),
			file('lib/features/reader/Words.svelte', '<!-- <Lonely /> import L from "$lib/components/Lonely.svelte" -->')
		];
		expect(sharedComponentFindings(planted)).toEqual(['lib/components/Lonely.svelte is used by only entry']);
	});

	it('the frame and a core feature count as users', () => {
		const planted = [
			file('lib/components/Flag.svelte'),
			file('lib/frame/NavDrawer.svelte', imp('$lib/components/Flag.svelte')),
			file('lib/features/reader/Library.svelte', imp('$lib/components/Flag.svelte'))
		];
		expect(sharedComponentFindings(planted)).toEqual([]);
	});

	it('an import that names no file (a moved or misspelt path; .js names the .ts)', () => {
		const planted = [
			file('lib/api/client.ts'),
			file('lib/entry/EntryView.svelte', imp('$lib/entry/Gone.svelte') + imp('./missing') + imp('$lib/api/client.js')),
			file('lib/entry/lazy.ts', 'const m = import(`./alsoGone`);'),
			file('lib/entry/fixture.test.ts', "import x from './notHere';"),
			file('lib/entry/data.ts', "import d from '../../../../docs/contracts/x.json';"),
			file('routes/study/map/+page.ts', "import type { PageLoad } from './$types';")
		];
		expect(unresolvedImportFindings(planted)).toEqual([
			'lib/entry/EntryView.svelte: $lib/entry/Gone.svelte names no file',
			'lib/entry/EntryView.svelte: ./missing names no file',
			'lib/entry/lazy.ts: ./alsoGone names no file'
		]);
	});

	it('the study core or the exercises importing the flashcards feature (a test may; the other way is fine)', () => {
		const planted = [
			file('lib/features/flashcards/session/cardFlow.ts', "import { scheduleFor } from '$lib/studycore/scheduler';"),
			file('lib/features/flashcards/face/hints.ts'),
			file('lib/features/flashcards/mascot.ts'),
			file('lib/features/flashcards/commands/cards.ts'),
			file('lib/goals/goals.ts'),
			file('routes/study/session/+page.svelte'),
			file('lib/studycore/scheduler.ts'),
			file('lib/studycore/known.ts', "import { cardFlow } from '$lib/features/flashcards/session/cardFlow';"),
			file('lib/exercises/cloze.ts', "export { HINT_KINDS } from '../features/flashcards/face/hints.js';"),
			file('lib/studycore/data.test.ts', "import { addCard } from '$lib/features/flashcards/commands/cards';"),
			file('lib/studycore/mastery.ts', 'const m = import(`$lib/features/flashcards/mascot`);'),
			file('lib/studycore/page.ts', "import P from '../../routes/study/session/+page.svelte';"),
			file('lib/studycore/types.ts', "import type { ParsedGoals } from '../goals/goals';"),
			file('lib/studycore/exp.ts', "// import { x } from '$lib/features/flashcards/mascot';"),
			file('lib/features/courses/cards.ts', "import { addCard } from '$lib/features/flashcards/commands/cards';"),
			file('lib/features/courses/cards.test.ts', "import { addCard } from '$lib/features/flashcards/commands/cards';"),
			file('routes/courses/[...rest]/+page.svelte', "import { cardFlow } from '$lib/features/flashcards/session/cardFlow';")
		];
		expect(studyCoreImportFindings(planted)).toEqual([
			'lib/studycore/known.ts imports lib/features/flashcards/session/cardFlow.ts',
			'lib/exercises/cloze.ts imports lib/features/flashcards/face/hints.ts',
			'lib/studycore/mastery.ts imports lib/features/flashcards/mascot.ts',
			'lib/studycore/page.ts imports routes/study/session/+page.svelte',
			'lib/features/courses/cards.ts imports lib/features/flashcards/commands/cards.ts',
			'routes/courses/[...rest]/+page.svelte imports lib/features/flashcards/session/cardFlow.ts'
		]);
	});

	it('a top folder of lib that is in no class', () => {
		expect(unclassifiedFolderFindings([file('lib/quiz/quiz.ts'), file('lib/entry/EntryView.svelte')])).toEqual([
			'lib/quiz is not classified (logic, feature or structure folder)'
		]);
	});

	it('only lib/testing, lib/ui/testing and test files are test-only', () => {
		expect(isTestOnly('lib/testing/context.ts')).toBe(true);
		expect(isTestOnly('lib/ui/testing/Gallery.svelte')).toBe(true);
		expect(isTestOnly('lib/entry/EntryView.dom.test.ts')).toBe(true);
		expect(isTestOnly('lib/i18n/PseudoStub.test.svelte')).toBe(true);
		expect(isTestOnly('lib/entry/testing/SaveEditor.svelte')).toBe(false);
		expect(isTestOnly('lib/studycore/testing.ts')).toBe(false);
	});

	it('a component in a logic-only folder (a test stub is fine)', () => {
		const planted = [
			file('lib/studycore/DeckCardTypes.svelte'),
			file('lib/i18n/PseudoStub.test.svelte'),
			file('lib/entry/EntryView.svelte')
		];
		expect(logicFolderFindings(planted)).toEqual([
			'lib/studycore/DeckCardTypes.svelte is a component in the logic folder lib/studycore'
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
