#!/usr/bin/env node
// Derive the bundled ja components pack (kanjivg-components) from a KanjiVG
// checkout:
//
//   node scripts/prepare-kanjivg-components.mjs <kanjivg-checkout> <out-dir> \
//     --version <tag> --commit <sha>
//
// Reads <checkout>/kanji/<hex>.svg. Variant files (a "-" in the name) and
// anything that is not a CJK ideograph (kana, symbols) are skipped. For each
// kanji every nested kvg:element group except the kanji itself is a part,
// deduplicated in document order (split parts, kvg:part, count once); at
// most 32 are kept, outermost first. A part's stroke count is the number of
// paths in the part's own KanjiVG file when there is one, otherwise the most
// common path count among its unsplit groups (ties: the smaller count); a
// part with neither gets no parts.tsv line.
//
// Writes manifest.json, components.tsv and parts.tsv (the components-tsv
// format, server/internal/components). LICENSE and ATTRIBUTION.md are added
// by scripts/fetch-kanjivg-components.sh. KanjiVG is CC BY-SA 3.0; the
// derived index is shared under the same licence.
//
// The SVGs are read with regexes over KanjiVG's regular layout, never
// executed or loaded as XML.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MAX_PARTS = 32;

const TAG = /<(\/?)(g|path)\b([^>]*?)(\/?)>/g;
const ELEMENT = /\bkvg:element="([^"]*)"/;
const PART = /\bkvg:part="/;
const STROKE_PATHS = /\bid="kvg:StrokePaths_/;

/**
 * svgElements lists the kvg:element groups inside the StrokePaths group of a
 * KanjiVG file in document order: {element, paths, split}, where paths
 * counts every path nested in the group and split marks a kvg:part group.
 */
export function svgElements(svg) {
	const out = [];
	const stack = []; // {group, paths}
	let depth = -1; // stack depth of the StrokePaths group, -1 outside
	for (const [, close, tag, attrs, selfClose] of svg.matchAll(TAG)) {
		if (tag === 'path') {
			if (depth >= 0 && close === '') for (const frame of stack.slice(depth)) frame.paths += 1;
			continue;
		}
		if (close === '/') {
			const frame = stack.pop();
			if (frame?.group) frame.group.paths = frame.paths;
			if (stack.length === depth) depth = -1;
			continue;
		}
		const frame = { group: null, paths: 0 };
		if (depth < 0 && STROKE_PATHS.test(attrs)) depth = stack.length;
		const m = depth >= 0 ? ELEMENT.exec(attrs) : null;
		if (m) {
			frame.group = { element: m[1], paths: 0, split: PART.test(attrs) };
			out.push(frame.group);
		}
		stack.push(frame);
		if (selfClose === '/') stack.pop();
	}
	return out;
}

/** isIdeograph mirrors lexicon.IsHan: one Han code point, not a radical-block form or mark. */
export function isIdeograph(s) {
	const chars = [...s];
	if (chars.length !== 1 || !/^\p{Script=Han}$/u.test(s)) return false;
	const c = s.codePointAt(0);
	return !((c >= 0x2e80 && c <= 0x2fdf) || c === 0x303b || (c >= 0x16fe0 && c <= 0x16fff));
}

/** onePart is one printable, non-space code point (the import rule). */
const onePart = (s) => [...s].length === 1 && /^[\p{L}\p{M}\p{N}\p{P}\p{S}]$/u.test(s);

/**
 * buildIndex reads every kanji file of dir: chars maps a kanji to its parts,
 * strokes a part to its stroke count (only parts that occur in chars).
 */
export function buildIndex(dir) {
	const chars = new Map();
	const ownPaths = new Map(); // kanji -> path count of its own file
	const unsplit = new Map(); // part -> Map(count -> occurrences)
	for (const name of readdirSync(dir).sort()) {
		const m = /^([0-9a-f]{4,6})\.svg$/.exec(name);
		if (!m) continue; // variants (04e14-Kaisho.svg) and other files
		const kanji = String.fromCodePoint(parseInt(m[1], 16));
		if (!isIdeograph(kanji)) continue;
		const groups = svgElements(readFileSync(join(dir, name), 'utf8'));
		if (groups.length === 0) continue;
		ownPaths.set(kanji, groups[0].paths);
		const parts = [];
		for (const g of groups.slice(1)) {
			if (g.element === kanji || !onePart(g.element)) continue;
			if (!g.split) {
				const counts = unsplit.get(g.element) ?? new Map();
				counts.set(g.paths, (counts.get(g.paths) ?? 0) + 1);
				unsplit.set(g.element, counts);
			}
			if (!parts.includes(g.element)) parts.push(g.element);
		}
		if (parts.length > 0) chars.set(kanji, parts.slice(0, MAX_PARTS));
	}
	const strokes = new Map();
	for (const parts of chars.values()) {
		for (const p of parts) {
			if (strokes.has(p)) continue;
			let n = ownPaths.get(p) ?? 0;
			if (n === 0) {
				let best = 0;
				let seen = 0;
				for (const [count, times] of unsplit.get(p) ?? []) {
					if (count > 0 && (times > seen || (times === seen && count < best))) [best, seen] = [count, times];
				}
				n = best;
			}
			if (n >= 1 && n <= 64) strokes.set(p, n);
		}
	}
	return { chars, strokes };
}

const byCodePoint = (a, b) => a.codePointAt(0) - b.codePointAt(0);

/** writePack writes manifest.json, components.tsv and parts.tsv into out. */
export function writePack(out, { chars, strokes }, version, commit) {
	mkdirSync(out, { recursive: true });
	const head = [
		`# KanjiVG component index, derived from KanjiVG ${version} (commit ${commit}).`,
		'# KanjiVG (c) Ulrich Apel, https://kanjivg.tagaini.net, CC BY-SA 3.0; this file is shared under the same licence.'
	];
	const lines = [...chars.keys()].sort(byCodePoint).map((k) => `${k}\t${chars.get(k).join(' ')}`);
	writeFileSync(join(out, 'components.tsv'), [...head, '# kanji<TAB>parts', ...lines].join('\n') + '\n');
	const parts = [...strokes.keys()].sort(byCodePoint).map((p) => `${p}\t${strokes.get(p)}`);
	writeFileSync(join(out, 'parts.tsv'), [...head, '# part<TAB>strokes', ...parts].join('\n') + '\n');
	const manifest = {
		id: 'kanjivg-components',
		name: 'KanjiVG components',
		version,
		type: 'components',
		language: 'ja',
		license: 'CC BY-SA 3.0',
		attribution: 'KanjiVG © Ulrich Apel (https://kanjivg.tagaini.net); component index derived by qinqin',
		notice:
			`A component index derived from [KanjiVG](https://kanjivg.tagaini.net) ${version} (commit ${commit}): ` +
			'for each kanji, the elements its stroke-order drawing is built from, at every depth, with part stroke ' +
			'counts taken from the KanjiVG drawings. The elements are graphical, not etymological.\n\n' +
			'KanjiVG is copyright Ulrich Apel and licensed CC BY-SA 3.0; this derived index is shared under the same ' +
			'licence, see [the licence](https://creativecommons.org/licenses/by-sa/3.0/).',
		format: 'components-tsv'
	};
	writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
	return { chars: lines.length, parts: parts.length };
}

function main(argv) {
	const args = [];
	const opts = {};
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === '--version' || argv[i] === '--commit') opts[argv[i].slice(2)] = argv[++i];
		else args.push(argv[i]);
	}
	if (args.length !== 2 || !opts.version || !opts.commit) {
		console.error('usage: prepare-kanjivg-components.mjs <kanjivg-checkout> <out-dir> --version <tag> --commit <sha>');
		process.exit(2);
	}
	const index = buildIndex(join(args[0], 'kanji'));
	const n = writePack(args[1], index, opts.version, opts.commit);
	console.error(`kanjivg-components: ${n.chars} characters, ${n.parts} parts with stroke counts`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
