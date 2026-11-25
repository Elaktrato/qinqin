#!/usr/bin/env node
// Checks that the packs, docs/sources.md and the manifests' notices agree.
//
//   node scripts/check-sources.mjs [repo-root]
//
// The Sources page (/sources) is built from the pack manifests; this check
// keeps the repository honest about them:
//   a. every pack directory under plugins/data, plugins/samples and
//      server/internal/themes/builtin (the theme packs built into the
//      binary) has a manifest.json with a non-empty `license` and
//      `attribution`; a built-in theme pack also a non-empty LICENSE file
//      (the upstream licence text, shipped in the binary);
//   b. every bundled pack (plugins/data, the built-in theme packs) has its
//      manifest `id` mentioned, in backticks, in docs/sources.md;
//   c. every pack id docs/sources.md names in a "Pack" table row or in a
//      "- **Name** (`id`" list item exists under plugins/data or
//      plugins/samples, or is one of the optional local-only packs the docs
//      describe (LOCAL_ONLY_PACKS), a fetched, redistributable pack (FETCHED_PACKS)
//      or a pack a tool generates into plugins/data, before it ran (GENERATED_PACKS);
//   d. a manifest `notice` follows the server's rules (dict.ValidateNotice,
//      after the loader trims it): at most 4,000 bytes, no control
//      characters but \n and \t, no bidi embedding/override/isolate
//      characters, links written [text](https://host/...) that Go's
//      url.Parse accepts, and nothing else; plus no U+FFFD (broken UTF-8);
//   e. every font file bundled with the web app (.woff2, .woff, .ttf, .otf
//      under apps/web/src or apps/web/static) is named, in backticks, in
//      docs/sources.md, and the section (## heading) naming it also names
//      its licence text as `apps/web/static/<NAME>.TXT`, which must exist;
//   f. every vendored icon set (a non-test .ts module under
//      apps/web/src/lib/ui/icons) is named, in backticks, in docs/sources.md,
//      in a section that also names its licence text the same way.
//
// Exit code 0 when everything agrees, 1 with one message per problem.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Optional packs the docs describe that are never in the repository. */
export const LOCAL_ONLY_PACKS = [
	'jlpt-words',
	'hsk30-chars',
	'hsk30-words',
	'commons-audio-zh',
	'commons-audio-ja',
	'zh-components'
];
/**
 * Packs with a clear, redistributable licence that are fetched by a script
 * instead of being committed, because of their size: the docs may name them
 * like a bundled pack. The audio and strokes packs are baked into the
 * Docker image; the font packs (scripts/prepare-font-pack.mjs, one per
 * pinned source) are built on demand and installed by an administrator.
 */
export const FETCHED_PACKS = [
	'kanjialive-audio',
	'hanzi-writer-strokes',
	'noto-sans-sc',
	'noto-sans-tc',
	'noto-sans-jp',
	'noto-serif-sc',
	'noto-serif-tc',
	'noto-serif-jp',
	'lxgw-wenkai',
	'klee-one'
];
/**
 * Packs a maintainer tool generates into plugins/data, documented before
 * they exist: server/tools/tatoeba writes the example sentence packs from a
 * pinned Tatoeba export. The docs may name them while they are absent; once
 * generated they are bundled packs and every rule applies, and they must
 * match the tool's pin (generatedProblems).
 */
export const GENERATED_PACKS = ['zh-sentences-tatoeba', 'ja-sentences-tatoeba'];
/** The pin file of the tool that generates GENERATED_PACKS. */
export const TATOEBA_PIN = 'server/tools/tatoeba/pin.json';

/**
 * generatedProblems ties GENERATED_PACKS to the tool's pin: once pin.json
 * records the export (every archive hash), both packs must exist with
 * manifest version = the pinned export date; while it is not pinned, the
 * packs must be absent. versions maps pack id to manifest version (or
 * undefined when absent).
 */
function generatedProblems(root, versions) {
	const file = join(root, TATOEBA_PIN);
	let pin = { exportDate: '', archives: [] };
	if (existsSync(file)) {
		try {
			pin = JSON.parse(readFileSync(file, 'utf8'));
		} catch (e) {
			return [`${TATOEBA_PIN}: not valid JSON (${e.message})`];
		}
	}
	const archives = Array.isArray(pin.archives) ? pin.archives : [];
	const pinned = archives.length > 0 && archives.every((a) => /^[0-9a-f]{64}$/.test(a?.sha256 ?? ''));
	const out = [];
	for (const id of GENERATED_PACKS) {
		const present = versions.has(id);
		if (!pinned && present) {
			out.push(`${id}: plugins/data/${id} exists but ${TATOEBA_PIN} is not pinned; run the tool's pin step (or remove the pack)`);
		} else if (pinned && !present) {
			out.push(`${id}: ${TATOEBA_PIN} pins the export of ${pin.exportDate} but plugins/data/${id} is missing; run \`go run ./tools/tatoeba build\` and commit the pack`);
		} else if (pinned && versions.get(id) !== pin.exportDate) {
			out.push(`${id}: manifest version "${versions.get(id)}" is not the pinned export date ${pin.exportDate}; rebuild the pack`);
		}
	}
	return out;
}
export const MAX_NOTICE_BYTES = 4000;
/** The theme packs built into the server binary (server/internal/themes). */
export const BUILTIN_THEMES = 'server/internal/themes/builtin';

// Go's RE2 `\s` is ASCII whitespace only ([\t\n\f\r ]), so the URL part
// spells it out: a no-break space in a URL is part of the URL, as on the
// server.
const NOTICE_LINK = /\[([^[\]\n]+)\]\(([^()\t\n\f\r ]*)\)/g;
const PACK_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

// What Go's strings.TrimSpace removes (unicode.IsSpace): unlike JS trim(),
// it includes U+0085 and excludes U+FEFF.
const GO_SPACE = '[\\t\\n\\v\\f\\r \\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]';
const GO_TRIM = new RegExp(`^${GO_SPACE}+|${GO_SPACE}+$`, 'g');

const isHex = (c) => /^[0-9a-fA-F]$/.test(c ?? '');
const hexString = (s) => s.slice(0, 3);

/**
 * goUnescapeProblem mirrors the checks of net/url's unescape: every `%`
 * starts a two-hex-digit escape; in a host an escape below %80 other
 * than %25 is refused, and so is any ASCII character Go would escape
 * there. Returns a message or ''.
 */
function goUnescapeProblem(s, host) {
	for (let i = 0; i < s.length; ) {
		const c = s[i];
		if (c === '%') {
			if (i + 2 >= s.length || !isHex(s[i + 1]) || !isHex(s[i + 2])) {
				return `invalid URL escape "${hexString(s.slice(i))}"`;
			}
			if (host && parseInt(s[i + 1], 16) < 8 && s.slice(i, i + 3) !== '%25') {
				return `invalid URL escape "${s.slice(i, i + 3)}"`;
			}
			i += 3;
			continue;
		}
		if (host && c.charCodeAt(0) < 0x80 && !/[A-Za-z0-9\-_.~!$&'()*+,;=:[\]<>"]/.test(c)) {
			return `invalid character "${c}" in host name`;
		}
		i++;
	}
	return '';
}

/** validOptionalPort mirrors net/url: '' or ':' followed by digits only. */
const validOptionalPort = (p) => p === '' || /^:[0-9]*$/.test(p);

/**
 * goURLProblem mirrors dict.validateNoticeURL, which uses Go's url.Parse:
 * the fragment and path must hold valid escapes (the query is not
 * checked), the authority must carry no user information, the host
 * follows Go's host rules, and the host name must not be empty. The
 * port check (at most 65535) is the server's own. Returns a message or ''.
 */
function goURLProblem(raw) {
	if (!raw.startsWith('https://')) return 'only https:// links are allowed';
	const hash = raw.indexOf('#');
	const beforeFragment = hash < 0 ? raw : raw.slice(0, hash);
	const fragment = hash < 0 ? '' : raw.slice(hash + 1);
	let rest = beforeFragment.slice('https:'.length);
	if (!(rest.endsWith('?') && rest.split('?').length === 2)) {
		const q = rest.indexOf('?');
		if (q >= 0) rest = rest.slice(0, q);
	}
	let authority = rest.slice(2);
	let path = '';
	const slash = authority.indexOf('/');
	if (slash >= 0) [authority, path] = [authority.slice(0, slash), authority.slice(slash)];

	let problem = '';
	let host = authority;
	const at = authority.lastIndexOf('@');
	if (at >= 0) host = authority.slice(at + 1);
	if (host.startsWith('[')) {
		const close = host.lastIndexOf(']');
		if (close < 0) problem = "missing ']' in host";
		else if (!validOptionalPort(host.slice(close + 1))) problem = `invalid port "${host.slice(close + 1)}" after host`;
	} else {
		const colon = host.lastIndexOf(':');
		if (colon >= 0 && !validOptionalPort(host.slice(colon))) problem = `invalid port "${host.slice(colon)}" after host`;
	}
	problem ||= goUnescapeProblem(host, true) || goUnescapeProblem(path, false) || goUnescapeProblem(fragment, false);
	if (problem) return `invalid URL: ${problem}`;
	if (at >= 0) return 'the URL must not carry user information';

	// Hostname and Port, as Go splits them.
	let hostname = host;
	let port = '';
	const colon = host.lastIndexOf(':');
	if (colon >= 0 && validOptionalPort(host.slice(colon))) [hostname, port] = [host.slice(0, colon), host.slice(colon + 1)];
	if (hostname.startsWith('[') && hostname.endsWith(']')) hostname = hostname.slice(1, -1);
	if (host === '' || hostname === '') return 'the URL has no host';
	if (port !== '' && !(Number(port) <= 65535)) return `the URL port ${port} is out of range`;
	return '';
}

const isBidiControl = (c) => (c >= 0x202a && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069);

/**
 * noticeProblems mirrors the server's check of a manifest notice: the
 * pack loader trims it (strings.TrimSpace) and dict.ValidateNotice then
 * checks it. The shared vectors in scripts/testdata/notice-vectors.json
 * hold both to the same answers. Returns messages.
 */
export function noticeProblems(raw) {
	const s = raw.replace(GO_TRIM, '');
	const out = [];
	const bytes = Buffer.byteLength(s, 'utf8');
	if (bytes > MAX_NOTICE_BYTES) out.push(`notice is ${bytes} bytes, at most ${MAX_NOTICE_BYTES} allowed`);
	for (const ch of s) {
		const c = ch.codePointAt(0);
		if (ch !== '\n' && ch !== '\t' && (c < 0x20 || c === 0x7f || (c >= 0x80 && c < 0xa0))) {
			out.push(`notice contains the control character ${codePoint(c)} (only line breaks and tabs are allowed)`);
			break;
		}
		if (isBidiControl(c)) {
			out.push(`notice contains the bidirectional control character ${codePoint(c)}, which can reorder the displayed text`);
			break;
		}
	}
	for (const [, text, url] of s.matchAll(NOTICE_LINK)) {
		const reason = goURLProblem(url);
		if (reason) out.push(`notice link [${text}](${url}): ${reason}`);
	}
	const rest = s.replace(NOTICE_LINK, '');
	const i = rest.indexOf('](');
	if (i >= 0) {
		out.push(
			`notice has a malformed link near "${rest.slice(Math.max(0, i - 20), i + 20).replace(/\n/g, ' ')}": write links as [text](https://...), with no brackets in the text and no parentheses or spaces in the URL`
		);
	}
	return out;
}

const codePoint = (c) => `U+${c.toString(16).toUpperCase().padStart(4, '0')}`;

/** packDirs lists the subdirectories of dir (none when dir is missing). */
function packDirs(dir) {
	if (!existsSync(dir)) return [];
	return readdirSync(dir)
		.sort()
		.filter((n) => statSync(join(dir, n)).isDirectory());
}

/**
 * docPackIds extracts the pack ids docs/sources.md names per pack: in the
 * first cell of a table whose header's first cell is "Pack", and in a
 * "- **Name** (`id`" list item. Other tables (field lists and the like)
 * are not about packs.
 */
export function docPackIds(text) {
	const ids = new Set();
	let packTable = false;
	let inTable = false;
	for (const line of text.split('\n')) {
		let scope = '';
		if (line.startsWith('|')) {
			const first = line.split('|')[1] ?? '';
			if (!inTable) packTable = first.trim() === 'Pack'; // the header row
			else if (packTable) scope = first;
			inTable = true;
		} else {
			inTable = false;
			scope = line.match(/^\s*- \*\*[^*]+\*\* \((`[^`]+`)/)?.[1] ?? '';
		}
		for (const [, id] of scope.matchAll(/`([^`]+)`/g)) if (PACK_ID.test(id)) ids.add(id);
	}
	return ids;
}

const FONT_FILE = /\.(woff2?|ttf|otf)$/i;
const FONT_ROOTS = ['apps/web/src', 'apps/web/static'];

/** fontFiles lists the font files under the web app's source and static roots (repo-relative). */
function fontFiles(root) {
	const out = [];
	const walk = (rel) => {
		for (const e of readdirSync(join(root, rel), { withFileTypes: true })) {
			const child = `${rel}/${e.name}`;
			if (e.isDirectory()) walk(child);
			else if (FONT_FILE.test(e.name)) out.push(child);
		}
	};
	for (const base of FONT_ROOTS) if (existsSync(join(root, base))) walk(base);
	return out.sort();
}

/** docSections splits docs/sources.md at its `## ` headings. */
const docSections = (doc) => doc.split(/^## /m);

const ICON_DIR = 'apps/web/src/lib/ui/icons';

/** iconFiles lists the vendored icon modules (rule f). */
function iconFiles(root) {
	if (!existsSync(join(root, ICON_DIR))) return [];
	return readdirSync(join(root, ICON_DIR))
		.filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('.d.ts'))
		.map((name) => `${ICON_DIR}/${name}`)
		.sort();
}

/** namedWithLicence checks rules e and f: each file is named in a docs section that names an existing licence text. */
function namedWithLicence(root, doc, files, what) {
	const problems = [];
	for (const rel of files) {
		const name = '`' + rel.split('/').pop() + '`';
		const sections = docSections(doc).filter((s) => s.includes(name));
		if (sections.length === 0) {
			problems.push(
				`${rel}: ${what} is not named in docs/sources.md; name the file, in backticks, in a section that also names its licence text (\`apps/web/static/<NAME>.TXT\`)`
			);
			continue;
		}
		const licensed = sections.some((s) =>
			[...s.matchAll(/`apps\/web\/static\/([A-Za-z0-9._-]+\.TXT)`/g)].some(([, f]) => existsSync(join(root, 'apps/web/static', f)))
		);
		if (!licensed) problems.push(`${rel}: the docs/sources.md section naming it names no licence text that exists under apps/web/static`);
	}
	return problems;
}

/** fontProblems checks rule e for every bundled font file. */
const fontProblems = (root, doc) => namedWithLicence(root, doc, fontFiles(root), 'bundled font');

/** checkSources returns the list of problems under repo root `root`. */
export function checkSources(root) {
	const problems = [];
	const bundled = new Map(); // manifest id -> dir (plugins/data)
	const versions = new Map(); // manifest id -> version (plugins/data)
	const known = new Set([...LOCAL_ONLY_PACKS, ...FETCHED_PACKS, ...GENERATED_PACKS]);

	for (const base of ['plugins/data', 'plugins/samples', BUILTIN_THEMES]) {
		for (const name of packDirs(join(root, base))) {
			const rel = `${base}/${name}`;
			const file = join(root, rel, 'manifest.json');
			if (!existsSync(file)) {
				problems.push(`${rel}: no manifest.json; add one with id, license and attribution`);
				continue;
			}
			let m;
			try {
				m = JSON.parse(readFileSync(file, 'utf8'));
			} catch (e) {
				problems.push(`${rel}/manifest.json: not valid JSON (${e.message})`);
				continue;
			}
			const id = typeof m.id === 'string' ? m.id : '';
			if (!id) problems.push(`${rel}/manifest.json: missing "id"`);
			else {
				known.add(id);
				if (base !== 'plugins/samples') bundled.set(id, rel);
				if (base === 'plugins/data') versions.set(id, m.version);
			}
			if (base === BUILTIN_THEMES) {
				const lic = join(root, rel, 'LICENSE');
				if (!existsSync(lic) || readFileSync(lic, 'utf8').trim() === '') {
					problems.push(`${rel}: LICENSE is missing or empty; copy the palette's licence text verbatim from upstream`);
				}
			}
			for (const f of ['license', 'attribution']) {
				if (typeof m[f] !== 'string' || m[f].trim() === '') {
					problems.push(`${rel}/manifest.json: "${f}" is missing or empty; state it as the publisher does`);
				}
			}
			if (m.notice !== undefined) {
				if (typeof m.notice !== 'string') problems.push(`${rel}/manifest.json: "notice" must be a string`);
				else {
					for (const p of noticeProblems(m.notice)) problems.push(`${rel}/manifest.json: ${p}`);
					// Beyond the server: Go's JSON decoding turns invalid UTF-8 into
					// U+FFFD silently, so a broken encoding is caught here.
					if (m.notice.includes('\ufffd')) {
						problems.push(`${rel}/manifest.json: notice holds U+FFFD; the file is probably not valid UTF-8`);
					}
				}
			}
		}
	}

	problems.push(...generatedProblems(root, versions));

	const docFile = join(root, 'docs/sources.md');
	if (!existsSync(docFile)) {
		problems.push('docs/sources.md: file is missing');
		return problems;
	}
	const doc = readFileSync(docFile, 'utf8');
	for (const [id, rel] of bundled) {
		if (!doc.includes('`' + id + '`')) {
			problems.push(`docs/sources.md: bundled pack "${id}" (${rel}) is not mentioned; add it, in backticks, to the tables`);
		}
	}
	problems.push(...fontProblems(root, doc));
	problems.push(...namedWithLicence(root, doc, iconFiles(root), 'vendored icon set'));
	for (const id of docPackIds(doc)) {
		if (!known.has(id)) {
			problems.push(
				`docs/sources.md: names pack "${id}", which is not under plugins/data or plugins/samples; remove the row, or add it to LOCAL_ONLY_PACKS in scripts/check-sources.mjs if it is an optional local-only pack`
			);
		}
	}
	return problems;
}

function main() {
	const root = resolve(process.argv[2] ?? fileURLToPath(new URL('..', import.meta.url)));
	const problems = checkSources(root);
	if (problems.length) {
		console.error(`check-sources: ${problems.length} problem(s)`);
		for (const p of problems) console.error(`  - ${p}`);
		process.exit(1);
	}
	console.log('check-sources: packs, docs/sources.md and notices agree');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
