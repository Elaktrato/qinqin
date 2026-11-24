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
 * `lib/ui` when it is generic, to its feature otherwise).
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
	'lookups',
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

/** Loose files allowed directly in `lib/`, each with its reason. None today. */
export const LOOSE_ALLOWED: Record<string, string> = {};

/**
 * The feature a route shows, by its first folder under `src/routes` (`''` is a file at the routes root, keyed
 * by its name). A new route folder must be added here.
 */
export const ROUTE_FEATURES: Record<string, string> = {
	'+layout.svelte': 'frame',
	'+layout.ts': 'frame',
	'+page.svelte': 'widgets',
	account: 'account',
	entry: 'entry',
	flashcards: 'flashcards',
	grammar: 'grammar',
	journal: 'journal',
	login: 'account',
	lookups: 'lookups',
	p: 'routing',
	reader: 'reader',
	register: 'account',
	reset: 'account',
	search: 'search',
	settings: 'settings',
	sources: 'sources',
	stats: 'stats',
	study: 'flashcards'
};

/** Tests, test stubs and `testing/` harnesses: they may import anything and ship nothing. */
export function isTestOnly(path: string): boolean {
	return /\.test\.(ts|svelte)$/.test(path) || path.split('/').includes('testing');
}

const SPEC = /\bfrom\s*['"]([^'"\n]+)['"]|\bimport\s*\(\s*['"]([^'"\n]+)['"]\s*\)|\bimport\s+['"]([^'"\n]+)['"]/g;

/** The module specifiers a file imports (static, dynamic, side-effect, re-export). */
export function importSpecs(text: string): string[] {
	return [...text.matchAll(SPEC)].map((m) => m[1] ?? m[2] ?? m[3]);
}

function normalize(parts: string[]): string {
	const out: string[] = [];
	for (const p of parts) {
		if (p === '' || p === '.') continue;
		if (p === '..') out.pop();
		else out.push(p);
	}
	return out.join('/');
}

/** The source file a specifier names, or null for a package or a file outside `src`. */
export function resolveSpec(from: string, spec: string, known: Set<string>): string | null {
	const bare = spec.replace(/\?.*$/, '');
	let base: string;
	if (bare === '$lib' || bare.startsWith('$lib/')) base = normalize(['lib', ...bare.slice(5).split('/')]);
	else if (bare.startsWith('./') || bare.startsWith('../')) {
		base = normalize([...from.split('/').slice(0, -1), ...bare.split('/')]);
	} else return null;
	for (const suffix of ['', '.ts', '.js', '.svelte', '/index.ts']) {
		if (known.has(base + suffix)) return base + suffix;
	}
	return null;
}

/** The feature that owns a file: its folder under `lib` (`lib/features/<f>` counts as `<f>`), or its route. */
export function ownerOf(path: string): string {
	const parts = path.split('/');
	if (parts[0] === 'routes') {
		return ROUTE_FEATURES[parts[1]] ?? `unknown route folder ${parts[1]}`;
	}
	if (parts[0] !== 'lib' || parts.length < 3) return path;
	if (parts[1] === 'features' && parts.length >= 4) return parts[2];
	return parts[1];
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

/** 2. Every file in `lib/components` is used by two or more features (routes count as the feature they show). */
export function sharedComponentFindings(files: SourceFile[]): string[] {
	const g = graph(files);
	const out: string[] = [];
	for (const f of files) {
		if (!f.path.startsWith('lib/components/') || isTestOnly(f.path)) continue;
		const owners = new Set(
			[...(g.importers.get(f.path) ?? [])].filter((i) => !i.startsWith('lib/components/')).map(ownerOf)
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
