import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mdAnchors } from './testing/mdAnchors';

// Doc check for the architecture records in docs/architecture (#191): every record follows the template of
// docs/architecture/README.md, carries a known status, is listed once in the README's index with its own title and
// status, and its links resolve; the records are linked from the README front page and the wiki's Development page.
const root = resolve(__dirname, '../../../..');
const dir = resolve(root, 'docs/architecture');
const readme = existsSync(resolve(dir, 'README.md')) ? readFileSync(resolve(dir, 'README.md'), 'utf8') : '';

/** The template's sections, in order; "Open questions" may follow them. */
const SECTIONS = ['Status', 'Context', 'Decision', 'Consequences', 'Allowed / Not allowed', 'Enforcement'];
const OPTIONAL = 'Open questions';
const STATUS = /^(Accepted|Accepted, being implemented by #\d+|Superseded by \[(\d{4})\]\((\d{4}-[a-z0-9-]+\.md)\))$/;

const files = existsSync(dir)
	? readdirSync(dir)
			.filter((f) => f !== 'README.md' && f.endsWith('.md'))
			.sort()
	: [];

interface ArchRecord {
	file: string;
	number: string;
	title: string;
	sections: string[];
	status: string;
	text: string;
}

function parse(file: string): ArchRecord {
	const text = readFileSync(resolve(dir, file), 'utf8');
	const head = /^# (\d{4})\. (.+)$/m.exec(text.split('\n')[0] ?? '');
	const sections = [...text.matchAll(/^## (.+?)\s*$/gm)].map((m) => m[1]);
	const statusBody = /^## Status\s*\n+([^\n]+)/m.exec(text);
	return {
		file,
		number: head?.[1] ?? '',
		title: head?.[2]?.trim() ?? '',
		sections,
		status: statusBody?.[1]?.trim() ?? '',
		text
	};
}

const records = files.map(parse);

/** The index rows of the README: | [0001](0001-x.md) | Title | Status | */
const indexRows = [...readme.matchAll(/^\| \[(\d{4})\]\(([^)\s]+)\) \| (.+?) \| (.+?) \|\s*$/gm)].map((m) => ({
	number: m[1],
	file: m[2],
	title: m[3].trim(),
	status: m[4].trim()
}));

/** Text outside code blocks and code spans. */
const prose = (md: string): string => md.replace(/^```[\s\S]*?^```/gm, '').replace(/`[^`\n]*`/g, '');

/** Relative link targets of a Markdown text (no scheme) as path and optional anchor; a bare #anchor has path ''. */
function linkTargets(md: string): { path: string; anchor?: string }[] {
	return [...prose(md).matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)]
		.map((m) => m[1])
		.filter((t) => !/^[a-z][a-z0-9+.-]*:/i.test(t))
		.map((t) => {
			const [path, anchor] = t.split('#');
			return anchor === undefined ? { path } : { path, anchor };
		});
}

/** Relative link targets that name a file (no bare #anchor). */
const relativeLinks = (md: string): string[] => linkTargets(md).map((t) => t.path).filter((p) => p !== '');

/** Every link of `md` (a file in `from`) with an #anchor into a Markdown file points at a heading there. */
function expectAnchorsResolve(md: string, self: string): void {
	for (const { path, anchor } of linkTargets(md)) {
		if (anchor === undefined) continue;
		const file = path === '' ? self : resolve(dirname(self), path);
		if (!file.endsWith('.md') || !existsSync(file)) continue;
		expect(mdAnchors(readFileSync(file, 'utf8')).has(anchor), `${path}#${anchor}`).toBe(true);
	}
}

/** The source text an identifier of an Accepted record must occur in. */
function sourceBlob(): string {
	const out: string[] = [];
	const walk = (d: string, ext: RegExp): void => {
		if (!existsSync(d)) return;
		for (const e of readdirSync(d, { withFileTypes: true })) {
			if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
			const p = resolve(d, e.name);
			if (e.isDirectory()) walk(p, ext);
			else if (ext.test(e.name)) out.push(readFileSync(p, 'utf8'));
		}
	};
	walk(resolve(root, 'server'), /\.go$/);
	walk(resolve(root, 'apps/web/src'), /\.(ts|svelte)$/);
	walk(resolve(root, 'scripts'), /\.mjs$/);
	walk(resolve(root, 'docs/contracts'), /\.json$/);
	return out.join('\n');
}

/** Backticked identifiers of a record: `Name`, `name()` or `name(...`. */
function identifiers(md: string): string[] {
	const ids = new Set<string>();
	for (const m of md.matchAll(/`([A-Za-z_][A-Za-z0-9_]*)(?:\(\))?`/g)) ids.add(m[1]);
	for (const m of md.matchAll(/`([A-Za-z_][A-Za-z0-9_]*)\(/g)) ids.add(m[1]);
	return [...ids].sort();
}

/** The body of one `## name` section ('' when missing). */
function section(md: string, name: string): string {
	const start = md.indexOf(`\n## ${name}\n`);
	if (start < 0) return '';
	const rest = md.slice(start + name.length + 5);
	const end = rest.search(/^## /m);
	return end < 0 ? rest : rest.slice(0, end);
}

describe('docs/architecture/README.md', () => {
	it('exists and says how records differ from the contracts', () => {
		expect(readme, 'docs/architecture/README.md').not.toBe('');
		expect(readme).toContain('docs/contracts/');
		expect(readme).toMatch(/code structure/i);
	});

	it('describes the template and the status values', () => {
		for (const s of [...SECTIONS, OPTIONAL]) expect(readme, s).toContain(`## ${s}`);
		for (const s of ['Accepted', 'Accepted, being implemented by #', 'Superseded by']) expect(readme, s).toContain(s);
	});

	it('links only files that exist', () => {
		for (const t of relativeLinks(readme)) expect(existsSync(resolve(dir, t)), t).toBe(true);
		expectAnchorsResolve(readme, resolve(dir, 'README.md'));
	});

	it('says that a merge touching a record\'s area updates the record', () => {
		expect(readme).toMatch(/Touched by/);
	});
});

describe('the architecture records', () => {
	it('exist', () => {
		expect(records.length).toBeGreaterThanOrEqual(6);
	});

	it('are numbered 0001, 0002, ... without gaps, with a kebab-case name', () => {
		files.forEach((f, i) => expect(f).toMatch(new RegExp(`^${String(i + 1).padStart(4, '0')}-[a-z0-9]+(-[a-z0-9]+)*\\.md$`)));
	});

	it.each(records)('$file starts with "# NNNN. Title" matching its file name', (r) => {
		expect(r.number, 'heading "# NNNN. Title" on the first line').toBe(r.file.slice(0, 4));
		expect(r.title).not.toBe('');
	});

	it.each(records)('$file has the template sections in order', (r) => {
		const want = r.sections.at(-1) === OPTIONAL ? [...SECTIONS, OPTIONAL] : SECTIONS;
		expect(r.sections).toEqual(want);
	});

	it.each(records)('$file has a known status', (r) => {
		const m = STATUS.exec(r.status);
		expect(m, `status "${r.status}"`).not.toBeNull();
		if (m?.[2] !== undefined) {
			expect(m[3].slice(0, 4)).toBe(m[2]);
			expect(existsSync(resolve(dir, m[3])), m[3]).toBe(true);
		}
	});

	it.each(records)('$file is in the README index once, with its title and status', (r) => {
		const rows = indexRows.filter((row) => row.file === r.file);
		expect(rows, `index rows for ${r.file}`).toHaveLength(1);
		expect(rows[0].number).toBe(r.number);
		expect(rows[0].title).toBe(r.title);
		expect(rows[0].status).toBe(r.status);
	});

	it('the index lists no record that does not exist', () => {
		expect(indexRows.length).toBeGreaterThan(0);
		for (const row of indexRows) expect(files, row.file).toContain(row.file);
	});

	it.each(records)('$file links only files that exist', (r) => {
		for (const t of relativeLinks(r.text)) expect(existsSync(resolve(dirname(resolve(dir, r.file)), t)), t).toBe(true);
	});

	it.each(records)('$file links only headings that exist', (r) => {
		expectAnchorsResolve(r.text, resolve(dir, r.file));
	});

	it.each(records)('$file names the issues that touch it ("Touched by: #N, ...")', (r) => {
		expect(section(r.text, 'Status')).toMatch(/^Touched by: #\d+(, #\d+)*\b/m);
	});

	// A record in force names the code it describes; a renamed or deleted path must update the record.
	it.each(records.filter((r) => r.status === 'Accepted'))('$file names only repository paths that exist', (r) => {
		const paths = [...r.text.matchAll(/`((?:server|apps\/web|docs|scripts)\/[^`\s]+)`/g)].map((m) => m[1]);
		expect(paths.length, 'an Accepted record names the code it describes').toBeGreaterThan(0);
		for (const p of paths) expect(existsSync(resolve(root, p.replace(/[:#].*$/, ''))), p).toBe(true);
	});

	const accepted = records.filter((r) => r.status === 'Accepted');
	const blob = accepted.length > 0 ? sourceBlob() : '';

	// Function, type and constant names drift too: each one an in-force record names must still exist in the code.
	it.each(accepted)('$file names only identifiers that occur in the code or the contracts', (r) => {
		const ids = identifiers(r.text);
		expect(ids.length).toBeGreaterThan(0);
		for (const id of ids) expect(new RegExp(`\\b${id}\\b`).test(blob), id).toBe(true);
	});

	it.each(accepted)('$file describes enforcement that exists, not planned enforcement', (r) => {
		expect(section(r.text, 'Enforcement')).not.toMatch(/planned|being implemented|until then/i);
	});
});

describe('links to the architecture records', () => {
	it('the README development section links docs/architecture/README.md', () => {
		const front = readFileSync(resolve(root, 'README.md'), 'utf8');
		const from = front.indexOf('\n## Development\n');
		const next = front.indexOf('\n## ', from + 1);
		const dev = front.slice(from, next < 0 ? undefined : next);
		expect(dev).toContain('](docs/architecture/README.md)');
	});

	it.each(['Development.md', 'Project-layout.md'])('the wiki page %s links docs/architecture', (page) => {
		const text = readFileSync(resolve(root, 'docs/wiki', page), 'utf8');
		expect(text).toContain('](https://github.com/Elaktrato/qinqin/tree/develop/docs/architecture)');
	});
});
