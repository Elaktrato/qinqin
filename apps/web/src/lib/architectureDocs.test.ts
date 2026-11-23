import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

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

/** Relative link targets of a Markdown text (no scheme, no bare #anchor), outside code blocks and code spans. */
function relativeLinks(md: string): string[] {
	const prose = md.replace(/^```[\s\S]*?^```/gm, '').replace(/`[^`\n]*`/g, '');
	return [...prose.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)]
		.map((m) => m[1])
		.filter((t) => !/^[a-z][a-z0-9+.-]*:/i.test(t) && !t.startsWith('#'))
		.map((t) => t.split('#')[0]);
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

	// A record in force names the code it describes; a renamed or deleted path must update the record.
	it.each(records.filter((r) => r.status === 'Accepted'))('$file names only repository paths that exist', (r) => {
		const paths = [...r.text.matchAll(/`((?:server|apps\/web|docs|scripts)\/[^`\s]+)`/g)].map((m) => m[1]);
		expect(paths.length, 'an Accepted record names the code it describes').toBeGreaterThan(0);
		for (const p of paths) expect(existsSync(resolve(root, p.replace(/[:#].*$/, ''))), p).toBe(true);
	});
});

describe('links to the architecture records', () => {
	it('the README development section links docs/architecture/README.md', () => {
		const front = readFileSync(resolve(root, 'README.md'), 'utf8');
		const dev = front.slice(front.indexOf('## Development'));
		expect(dev).toContain('](docs/architecture/README.md)');
	});

	it.each(['Development.md', 'Project-layout.md'])('the wiki page %s links docs/architecture', (page) => {
		const text = readFileSync(resolve(root, 'docs/wiki', page), 'utf8');
		expect(text).toContain('](https://github.com/Elaktrato/qinqin/tree/develop/docs/architecture)');
	});
});
