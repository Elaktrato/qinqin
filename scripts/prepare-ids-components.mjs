#!/usr/bin/env node
// Turn an IDS file (Ideographic Description Sequences, the CHISE / cjkvi
// layout: U+XXXX<TAB>char<TAB>IDS[<TAB>more IDS]) into a LOCAL-ONLY
// components pack for the radical and part lookup:
//
//   node scripts/prepare-ids-components.mjs <ids.txt> <out-dir> \
//     --id zh-components --license "<as stated by the source>" \
//     --attribution "<who, with a link>" [--unihan Unihan_IRGSources.txt] \
//     [--language zh] [--name "Chinese components"] [--version <v>]
//
// The usual IDS sources are copyleft (CHISE IDS GPL-2.0-or-later, cjkvi-ids
// "follows CHISE terms") or have an unverified chain (Make Me a Hanzi, LGPL):
// they are never bundled. Write the pack under the gitignored
// plugins/data-local/ and seed it there; this script refuses to write into
// plugins/data or plugins/samples. The manifest carries the licence and
// attribution you pass, as the source states them.
//
// Rules: the first IDS of each line counts; ideographic description
// characters (U+2FF0–U+2FFF, U+31EF), &…; entities, ？ and region tags
// (^ $ (…) […]) are dropped. Every part is expanded recursively from the same
// file (preorder, deduplicated, never the character itself, with a cycle
// guard), at most 32 parts. Only Han characters get a line; a character
// without parts gets none. With --unihan, a part's stroke count is the first
// kTotalStrokes value of Unihan_IRGSources.txt.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAX_PARTS, isIdeograph } from './prepare-kanjivg-components.mjs';

const IDC = (c) => (c >= 0x2ff0 && c <= 0x2fff) || c === 0x31ef;

/** cleanIDS returns the components of one IDS, in order. */
export function cleanIDS(ids) {
	const s = ids
		.replace(/&[^;\s]*;/g, '')
		.replace(/\([^)]*\)|\[[^\]]*\]/g, '')
		.replace(/[\^$？?]/g, '');
	const out = [];
	for (const ch of s) {
		const c = ch.codePointAt(0);
		if (IDC(c) || /\s/.test(ch)) continue;
		out.push(ch);
	}
	return out;
}

/** parseIDS reads the file into char -> direct components (first IDS). */
export function parseIDS(text) {
	const direct = new Map();
	for (const line of text.split('\n')) {
		if (line === '' || line.startsWith('#') || line.startsWith(';')) continue;
		const fields = line.replace(/\r$/, '').split('\t');
		if (fields.length < 3) continue;
		const char = fields[1];
		if ([...char].length !== 1 || direct.has(char)) continue;
		direct.set(char, cleanIDS(fields[2]));
	}
	return direct;
}

/** expandAll expands every character's components recursively. */
export function expandAll(direct) {
	const out = new Map();
	for (const char of direct.keys()) {
		const parts = [];
		const visiting = new Set([char]);
		const walk = (c) => {
			for (const p of direct.get(c) ?? []) {
				if (p === char || parts.includes(p)) continue;
				parts.push(p);
				if (!visiting.has(p)) {
					visiting.add(p);
					walk(p);
					visiting.delete(p);
				}
			}
		};
		walk(char);
		if (parts.length > 0) out.set(char, parts.slice(0, MAX_PARTS));
	}
	return out;
}

/** unihanStrokes reads the first kTotalStrokes value of each code point. */
export function unihanStrokes(text) {
	const out = new Map();
	for (const line of text.split('\n')) {
		const f = line.split('\t');
		if (f.length < 3 || f[1] !== 'kTotalStrokes' || !/^U\+[0-9A-F]{4,6}$/.test(f[0])) continue;
		const n = Number(f[2].trim().split(/\s+/)[0]);
		if (Number.isInteger(n) && n >= 1 && n <= 64) out.set(String.fromCodePoint(parseInt(f[0].slice(2), 16)), n);
	}
	return out;
}

const byCodePoint = (a, b) => a.codePointAt(0) - b.codePointAt(0);
const onePart = (s) => [...s].length === 1 && /^[\p{L}\p{M}\p{N}\p{P}\p{S}]$/u.test(s);

function usage(msg) {
	console.error(`${msg ? msg + '\n' : ''}usage: prepare-ids-components.mjs <ids.txt> <out-dir> --id <id> --license <licence> --attribution <attribution> [--unihan Unihan_IRGSources.txt] [--language zh] [--name <name>] [--version <v>]`);
	process.exit(2);
}

function main(argv) {
	const args = [];
	const opts = { language: 'zh' };
	for (let i = 0; i < argv.length; i++) {
		const m = /^--(id|license|attribution|unihan|language|name|version)$/.exec(argv[i]);
		if (m) opts[m[1]] = argv[++i];
		else args.push(argv[i]);
	}
	if (args.length !== 2 || !opts.id || !opts.license || !opts.attribution) usage();

	const repo = fileURLToPath(new URL('..', import.meta.url));
	const out = resolve(args[1]);
	for (const committed of ['plugins/data', 'plugins/samples']) {
		const rel = relative(join(repo, committed), out);
		if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) {
			usage(`refusing to write into ${committed}: IDS decompositions are local-only; use plugins/data-local/`);
		}
	}

	const direct = parseIDS(readFileSync(args[0], 'utf8'));
	const chars = new Map();
	for (const [char, parts] of expandAll(direct)) {
		if (!isIdeograph(char)) continue;
		const kept = parts.filter(onePart);
		if (kept.length > 0) chars.set(char, kept);
	}
	const strokes = opts.unihan ? unihanStrokes(readFileSync(opts.unihan, 'utf8')) : null;

	mkdirSync(out, { recursive: true });
	const head = [`# ${opts.attribution}. Licence as stated by the source: ${opts.license}. Local-only; do not commit.`];
	const lines = [...chars.keys()].sort(byCodePoint).map((c) => `${c}\t${chars.get(c).join(' ')}`);
	writeFileSync(join(out, 'components.tsv'), [...head, '# char<TAB>parts', ...lines].join('\n') + '\n');
	let partLines = 0;
	if (strokes) {
		const used = new Set([...chars.values()].flat());
		const rows = [...used].filter((p) => strokes.has(p)).sort(byCodePoint).map((p) => `${p}\t${strokes.get(p)}`);
		partLines = rows.length;
		writeFileSync(join(out, 'parts.tsv'), [...head, '# part<TAB>strokes (Unihan kTotalStrokes)', ...rows].join('\n') + '\n');
	}
	const manifest = {
		id: opts.id,
		name: opts.name ?? 'Chinese components (local)',
		version: opts.version ?? new Date().toISOString().slice(0, 10),
		type: 'components',
		language: opts.language,
		license: opts.license,
		attribution: opts.attribution,
		format: 'components-tsv'
	};
	writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
	console.error(`${opts.id}: ${lines.length} characters, ${partLines} parts with stroke counts, written to ${out}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
