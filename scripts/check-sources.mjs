#!/usr/bin/env node
// Checks that the packs, docs/sources.md and the manifests' notices agree.
//
//   node scripts/check-sources.mjs [repo-root]
//
// The Sources page (/sources) is built from the pack manifests; this check
// keeps the repository honest about them:
//   a. every pack directory under plugins/data and plugins/samples has a
//      manifest.json with a non-empty `license` and `attribution`;
//   b. every bundled pack (plugins/data) has its manifest `id` mentioned,
//      in backticks, in docs/sources.md;
//   c. every pack id docs/sources.md names in a per-pack table row or in a
//      "- **Name** (`id`" list item exists under plugins/data or
//      plugins/samples, or is one of the optional local-only packs the docs
//      describe (LOCAL_ONLY_PACKS);
//   d. a manifest `notice` follows the server's rules (dict.ValidateNotice):
//      at most 4,000 bytes, valid UTF-8, no control characters but \n and
//      \t, links written [text](https://host/...) and nothing else.
//
// Exit code 0 when everything agrees, 1 with one message per problem.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Optional packs the docs describe that are never in the repository. */
export const LOCAL_ONLY_PACKS = ['jlpt-words', 'hsk30-chars', 'hsk30-words'];
export const MAX_NOTICE_BYTES = 4000;

const NOTICE_LINK = /\[([^[\]\n]+)\]\(([^()\s]*)\)/g;
const PACK_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/** noticeProblems mirrors dict.ValidateNotice; returns messages. */
export function noticeProblems(s) {
	const out = [];
	const bytes = Buffer.byteLength(s, 'utf8');
	if (bytes > MAX_NOTICE_BYTES) out.push(`notice is ${bytes} bytes, at most ${MAX_NOTICE_BYTES} allowed`);
	if (s.includes('�')) out.push('notice is not valid UTF-8 (contains U+FFFD)');
	for (const ch of s) {
		const c = ch.codePointAt(0);
		if (ch !== '\n' && ch !== '\t' && (c < 0x20 || c === 0x7f || (c >= 0x80 && c < 0xa0))) {
			out.push(`notice contains the control character U+${c.toString(16).toUpperCase().padStart(4, '0')} (only line breaks and tabs are allowed)`);
			break;
		}
	}
	for (const [, text, url] of s.matchAll(NOTICE_LINK)) {
		let reason = '';
		if (!url.startsWith('https://')) reason = 'only https:// links are allowed';
		else if (url.slice(8).split(/[/?#]/)[0] === '') reason = 'the URL has no host';
		else {
			try {
				const u = new URL(url);
				if (!u.hostname) reason = 'the URL has no host';
				else if (u.username || u.password) reason = 'the URL must not carry user information';
			} catch {
				reason = 'invalid URL';
			}
		}
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

/** packDirs lists the subdirectories of dir (none when dir is missing). */
function packDirs(dir) {
	if (!existsSync(dir)) return [];
	return readdirSync(dir)
		.sort()
		.filter((n) => statSync(join(dir, n)).isDirectory());
}

/** docPackIds extracts the pack ids docs/sources.md names in per-pack rows. */
export function docPackIds(text) {
	const ids = new Set();
	for (const line of text.split('\n')) {
		let scope = '';
		if (line.startsWith('|')) scope = line.split('|')[1] ?? '';
		else scope = line.match(/^\s*- \*\*[^*]+\*\* \((`[^`]+`)/)?.[1] ?? '';
		for (const [, id] of scope.matchAll(/`([^`]+)`/g)) if (PACK_ID.test(id)) ids.add(id);
	}
	return ids;
}

/** checkSources returns the list of problems under repo root `root`. */
export function checkSources(root) {
	const problems = [];
	const bundled = new Map(); // manifest id -> dir (plugins/data)
	const known = new Set(LOCAL_ONLY_PACKS);

	for (const base of ['plugins/data', 'plugins/samples']) {
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
				if (base === 'plugins/data') bundled.set(id, rel);
			}
			for (const f of ['license', 'attribution']) {
				if (typeof m[f] !== 'string' || m[f].trim() === '') {
					problems.push(`${rel}/manifest.json: "${f}" is missing or empty; state it as the publisher does`);
				}
			}
			if (m.notice !== undefined) {
				if (typeof m.notice !== 'string') problems.push(`${rel}/manifest.json: "notice" must be a string`);
				else for (const p of noticeProblems(m.notice)) problems.push(`${rel}/manifest.json: ${p}`);
			}
		}
	}

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
