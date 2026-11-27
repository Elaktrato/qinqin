// The web folder rules of record 0004 (docs/architecture/0004-web-folder-rules.md), as pure checks over a list
// of source files, so folderRules.test.ts runs them on the real tree and on small planted trees. A file is
// named by its path under apps/web/src (`lib/ui/Button.svelte`, `routes/+layout.svelte`).

export interface SourceFile {
	path: string;
	text: string;
}

/** What `lib/ui` may import besides itself: translated labels and the design tokens. */
export const UI_MAY_IMPORT = ['lib/ui/', 'lib/i18n/', 'lib/theme/'];

/**
 * The shared layers below the features: they hold logic only, so a component never sits in them (it goes to
 * `lib/ui` when it is generic, to its feature otherwise). They are not users of `lib/components`.
 */
export const LOGIC_FOLDERS = [
	'api',
	'audio',
	'auth',
	'context',
	'events',
	'fonts',
	'i18n',
	'languages',
	'native',
	'packages',
	'radicals',
	'routing',
	'session',
	'study',
	'sync',
	'theme',
	'time',
	'writing'
];

/**
 * The feature folders at the top of `lib/` (the four switchable features are `lib/features/<feature>`). Each
 * owns its UI and logic and counts as a user of `lib/components`.
 */
export const FEATURE_FOLDERS = [
	'account',
	'activity',
	'admin',
	'aids',
	'entry',
	'goals',
	'lookups',
	'milestones',
	'notes',
	'placement',
	'pwa',
	'reminders',
	'search',
	'settings',
	'sources',
	'starter',
	'stats',
	'weekly',
	'widgets',
	'workspace'
];

/**
 * The other top folders: the building blocks, the app chrome (`frame`, which counts as a user of
 * `lib/components`), the shared widgets, the switchable features' parent, test support and static assets.
 */
export const STRUCTURE_FOLDERS = ['ui', 'frame', 'components', 'features', 'testing', 'assets'];

/**
 * The shared study core (#278): the study cache and read model, the event log, the derived schedules and mastery,
 * the learner's day, and the exercises flashcards share with grammar and the drills. Every feature may read them;
 * they never import the flashcards feature (`FLASHCARDS`), so a feature that reads them does not pull in flashcards.
 */
export const STUDY_CORE_FOLDERS = ['studycore', 'exercises'];

/** What the study core must not import: the flashcards feature and the routes that show it. */
export const FLASHCARDS = ['lib/features/flashcards/', 'routes/study/', 'routes/flashcards/'];

/** Loose files allowed directly in `lib/`, each with its reason. None today. */
export const LOOSE_ALLOWED: Record<string, string> = {};

/**
 * What a route shows, by its first folder under `src/routes` (a file at the routes root is keyed by its name):
 * a feature folder, `features/<feature>`, `frame`, or a logic folder (`p`: the old plugin URLs, which only
 * redirect). A new route folder must be added here.
 */
export const ROUTE_FEATURES: Record<string, string> = {
	'+layout.svelte': 'frame',
	'+layout.ts': 'frame',
	'+page.svelte': 'widgets',
	account: 'account',
	entry: 'entry',
	flashcards: 'features/flashcards',
	grammar: 'features/grammar',
	journal: 'features/journal',
	login: 'account',
	lookups: 'lookups',
	p: 'routing',
	reader: 'features/reader',
	register: 'account',
	reset: 'account',
	scripts: 'features/scripts',
	search: 'search',
	settings: 'settings',
	sources: 'sources',
	stats: 'stats',
	study: 'features/flashcards'
};

/**
 * Tests, test stubs and the shared test support (`lib/testing`, the UI gallery in `lib/ui/testing`): they may
 * import anything and ship nothing. A feature's own `testing/` harness is checked like the feature.
 */
export function isTestOnly(path: string): boolean {
	return /\.test\.[a-z]+$/.test(path) || path.startsWith('lib/testing/') || path.startsWith('lib/ui/testing/');
}

/**
 * The text with its comments (`//`, `/* *\/`, `<!-- -->`) blanked, strings kept, so a commented-out import
 * is no import. Regular-expression literals are not recognised; a quote inside one can only hide a later
 * comment, never invent an import.
 */
export function stripComments(text: string): string {
	let out = '';
	let i = 0;
	while (i < text.length) {
		const c = text[i];
		const next = text[i + 1];
		if (c === '/' && next === '/') {
			while (i < text.length && text[i] !== '\n') i++;
		} else if (c === '/' && next === '*') {
			const end = text.indexOf('*/', i + 2);
			i = end < 0 ? text.length : end + 2;
			out += ' ';
		} else if (c === '<' && text.startsWith('<!--', i)) {
			const end = text.indexOf('-->', i + 4);
			i = end < 0 ? text.length : end + 3;
			out += ' ';
		} else if (c === "'" || c === '"' || c === '`') {
			let j = i + 1;
			while (j < text.length && text[j] !== c && !(c !== '`' && text[j] === '\n')) j += text[j] === '\\' ? 2 : 1;
			out += text.slice(i, j + 1);
			i = j + 1;
		} else {
			out += c;
			i++;
		}
	}
	return out;
}

const SPEC =
	/\bfrom\s*['"]([^'"\n]+)['"]|\bimport\s*\(\s*(?:['"]([^'"\n]+)['"]|`((?:[^`$\n]|\$(?!\{))+)`)\s*\)|\bimport\s+['"]([^'"\n]+)['"]/g;

/**
 * The module specifiers a file imports (static, dynamic with a plain or template string, side-effect,
 * re-export), comments left out.
 */
export function importSpecs(text: string): string[] {
	return [...stripComments(text).matchAll(SPEC)].map((m) => m[1] ?? m[2] ?? m[3] ?? m[4]);
}

/** The path of the parts below `src`, or null when `..` climbs out of it. */
function normalize(parts: string[]): string | null {
	const out: string[] = [];
	for (const p of parts) {
		if (p === '' || p === '.') continue;
		if (p === '..') {
			if (out.length === 0) return null;
			out.pop();
		} else out.push(p);
	}
	return out.join('/');
}

/** Whether a specifier names a source file under `src` (`$lib/...` or relative, generated `$types` aside). */
function namesSource(from: string, spec: string): boolean {
	const bare = spec.replace(/\?.*$/, '');
	if (bare === '$lib' || bare.startsWith('$lib/')) return true;
	if (!bare.startsWith('./') && !bare.startsWith('../')) return false;
	if (/(^|\/)\$types$/.test(bare)) return false;
	return normalize([...from.split('/').slice(0, -1), ...bare.split('/')]) !== null;
}

/**
 * The source file a specifier names, or null for a package, a file outside `src`, or a path that names no file
 * (`unresolvedImportFindings` reports those). A `.js` ending names the `.ts` file, as TypeScript resolves it.
 */
export function resolveSpec(from: string, spec: string, known: Set<string>): string | null {
	if (!namesSource(from, spec)) return null;
	const bare = spec.replace(/\?.*$/, '');
	const base =
		bare === '$lib' || bare.startsWith('$lib/')
			? normalize(['lib', ...bare.slice(5).split('/')])
			: normalize([...from.split('/').slice(0, -1), ...bare.split('/')]);
	if (base === null) return null;
	const candidates = [base, `${base}.ts`, `${base}.js`, `${base}.svelte`, `${base}/index.ts`];
	if (base.endsWith('.js')) candidates.push(`${base.slice(0, -3)}.ts`);
	return candidates.find((c) => known.has(c)) ?? null;
}

/**
 * The user a file counts as for `lib/components`: a feature folder, `features/<feature>`, the frame, or the
 * feature a route shows. Anything else (a logic folder, `lib/ui`, `lib/features` itself, a file at the top of
 * `src`, a route of a logic folder) is no user: null.
 */
export function ownerOf(path: string): string | null {
	const parts = path.split('/');
	let owner: string | undefined;
	if (parts[0] === 'routes') owner = ROUTE_FEATURES[parts[1]];
	else if (parts[0] === 'lib' && parts.length >= 3) {
		owner = parts[1] === 'features' ? (parts.length >= 4 ? `features/${parts[2]}` : undefined) : parts[1];
	}
	if (owner === undefined) return null;
	if (owner === 'frame' || FEATURE_FOLDERS.includes(owner) || owner.startsWith('features/')) return owner;
	return null;
}

interface Graph {
	known: Set<string>;
	/** For each file, the files that import it (tests and harnesses left out). */
	importers: Map<string, Set<string>>;
	imports: Map<string, string[]>;
}

function graph(files: SourceFile[]): Graph {
	const known = new Set(files.map((f) => f.path));
	const importers = new Map<string, Set<string>>();
	const imports = new Map<string, string[]>();
	for (const f of files) {
		const targets = importSpecs(f.text)
			.map((s) => resolveSpec(f.path, s, known))
			.filter((t): t is string => t !== null);
		imports.set(f.path, targets);
		if (isTestOnly(f.path)) continue;
		for (const t of targets) {
			if (!importers.has(t)) importers.set(t, new Set());
			importers.get(t)!.add(f.path);
		}
	}
	return { known, importers, imports };
}

/** 1. Nothing in `lib/ui` imports a feature folder, `lib/components` or another domain module. */
export function uiImportFindings(files: SourceFile[]): string[] {
	const g = graph(files);
	const out: string[] = [];
	for (const f of files) {
		if (!f.path.startsWith('lib/ui/') || f.path.startsWith('lib/ui/testing/')) continue;
		for (const t of g.imports.get(f.path) ?? []) {
			if (!UI_MAY_IMPORT.some((p) => t.startsWith(p))) out.push(`${f.path} imports ${t}`);
		}
	}
	return out;
}

/** Nothing in the study core (`STUDY_CORE_FOLDERS`), tests included, imports the flashcards feature. */
export function studyCoreImportFindings(files: SourceFile[]): string[] {
	const g = graph(files);
	const out: string[] = [];
	for (const f of files) {
		if (!STUDY_CORE_FOLDERS.some((d) => f.path.startsWith(`lib/${d}/`))) continue;
		for (const t of g.imports.get(f.path) ?? []) {
			if (FLASHCARDS.some((p) => t.startsWith(p))) out.push(`${f.path} imports ${t}`);
		}
	}
	return out;
}

/** 2. Every file in `lib/components` is used by two or more features (routes count as the feature they show). */
export function sharedComponentFindings(files: SourceFile[]): string[] {
	const g = graph(files);
	const out: string[] = [];
	for (const f of files) {
		if (!f.path.startsWith('lib/components/') || isTestOnly(f.path)) continue;
		const owners = new Set(
			[...(g.importers.get(f.path) ?? [])]
				.filter((i) => !i.startsWith('lib/components/'))
				.map(ownerOf)
				.filter((o): o is string => o !== null)
		);
		if (owners.size < 2) {
			out.push(`${f.path} is used by ${owners.size === 0 ? 'no feature' : `only ${[...owners].join('')}`}`);
		}
	}
	return out;
}

/** 3. No component sits in a logic-only folder. */
export function logicFolderFindings(files: SourceFile[]): string[] {
	return files
		.filter((f) => f.path.endsWith('.svelte') && !isTestOnly(f.path))
		.filter((f) => f.path.startsWith('lib/') && LOGIC_FOLDERS.includes(f.path.split('/')[1]))
		.map((f) => `${f.path} is a component in the logic folder lib/${f.path.split('/')[1]}`);
}

/** 4. No two components under `lib` share a file name. */
export function duplicateNameFindings(files: SourceFile[]): string[] {
	const byName = new Map<string, string[]>();
	for (const f of files) {
		if (!f.path.startsWith('lib/') || !f.path.endsWith('.svelte') || isTestOnly(f.path)) continue;
		const name = f.path.slice(f.path.lastIndexOf('/') + 1);
		byName.set(name, [...(byName.get(name) ?? []), f.path]);
	}
	return [...byName].filter(([, ps]) => ps.length > 1).map(([n, ps]) => `${n}: ${ps.join(', ')}`);
}

/** 5. No loose file at the top of `lib/` except the allow-list. */
export function looseFileFindings(files: SourceFile[]): string[] {
	return files
		.filter((f) => /^lib\/[^/]+$/.test(f.path) && !(f.path.slice(4) in LOOSE_ALLOWED))
		.map((f) => `${f.path} is a loose file at the top of lib/`);
}

/** Every route folder has a feature in ROUTE_FEATURES. */
export function unmappedRouteFindings(files: SourceFile[]): string[] {
	const keys = new Set(
		files.filter((f) => f.path.startsWith('routes/') && !isTestOnly(f.path)).map((f) => f.path.split('/')[1])
	);
	return [...keys].filter((k) => !(k in ROUTE_FEATURES)).map((k) => `routes/${k} has no feature in ROUTE_FEATURES`);
}

/** Every `$lib/` or relative import of a shipped file names a file (a test's own imports fail that test). */
export function unresolvedImportFindings(files: SourceFile[]): string[] {
	const known = new Set(files.map((f) => f.path));
	const out: string[] = [];
	for (const f of files) {
		if (isTestOnly(f.path)) continue;
		for (const spec of importSpecs(f.text)) {
			if (namesSource(f.path, spec) && resolveSpec(f.path, spec, known) === null) {
				out.push(`${f.path}: ${spec} names no file`);
			}
		}
	}
	return out;
}

/** Every top folder of `lib/` is a logic, feature or structure folder. */
export function unclassifiedFolderFindings(files: SourceFile[]): string[] {
	const classes = new Set([...LOGIC_FOLDERS, ...FEATURE_FOLDERS, ...STRUCTURE_FOLDERS]);
	const tops = new Set(files.filter((f) => /^lib\/[^/]+\//.test(f.path)).map((f) => f.path.split('/')[1]));
	return [...tops]
		.filter((d) => !classes.has(d))
		.map((d) => `lib/${d} is not classified (logic, feature or structure folder)`);
}
