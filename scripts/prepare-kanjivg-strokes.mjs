#!/usr/bin/env node
// Build the Japanese stroke-order data pack `kanjivg-strokes` (type strokes,
// format hanzi-writer-jsonl-gz, languages ["ja"]) from a KanjiVG checkout:
//
//   node scripts/prepare-kanjivg-strokes.mjs <kanjivg>/kanji <out-dir> --version <tag> --commit <sha>
//
// Reads <kanji dir>/<hex>.svg. Variant files (a "-" in the name) and anything
// that is not kana, a kanji or an iteration mark are skipped. KanjiVG draws
// each stroke as the centre line of the pen (an SVG path of cubic curves, in
// a 109 x 109 box, y down). The stroke-data format the app already reads
// (Hanzi Writer's: strokes = filled outlines, medians = centre lines, a 1024
// box, y up, baseline 900) needs both, so each path is flattened into a
// polyline (the median) and widened into a closed outline of constant width
// (HALF_WIDTH on each side, round caps). That makes the pack an ADAPTATION of
// KanjiVG: it stays under CC BY-SA 3.0 and says it was changed (manifest
// notice, ATTRIBUTION.md). The app, the writing pad and the stroke player
// need no new code to read it.
//
// Writes manifest.json, strokes.jsonl.gz and ATTRIBUTION.md; LICENSE (KanjiVG's
// COPYING) is added by scripts/fetch-kanjivg-strokes.sh. The SVGs are read with
// regexes over KanjiVG's regular layout, never executed or loaded as XML.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

export const PACK_ID = 'kanjivg-strokes';
export const FORMAT = 'hanzi-writer-jsonl-gz';
const NAME = 'KanjiVG stroke data';
const LICENSE = 'CC BY-SA 3.0';
const ATTRIBUTION = 'KanjiVG © Ulrich Apel (https://kanjivg.tagaini.net); outlines derived by qinqin';

/** Half the stroke width in KanjiVG units (the box is 109): a pen about 5 % of the box wide. */
export const HALF_WIDTH = 2.75;
/** The server refuses a stroke line over 64 KiB (strokes.MaxLineBytes). */
const MAX_LINE_BYTES = 64 << 10;

const NUMBER = /[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi;

/** parsePath reads a KanjiVG path (M, m, C, c, S, s) into cubic segments [[p0, c1, c2, p3], ...]. */
export function parsePath(d) {
	const segs = [];
	let cur = null;
	let lastC2 = null; // the previous cubic's second control point, for S
	let started = false;
	for (const [, cmd, args] of d.matchAll(/([A-Za-z])([^A-Za-z]*)/g)) {
		const nums = [...args.matchAll(NUMBER)].map((m) => Number(m[0]));
		if (!started && cmd !== 'M' && cmd !== 'm') throw new Error('path must start with M');
		switch (cmd) {
			case 'M':
			case 'm': {
				if (started) throw new Error('more than one subpath');
				if (nums.length !== 2) throw new Error(`unsupported move with ${nums.length} numbers`);
				cur = [nums[0], nums[1]];
				started = true;
				lastC2 = null;
				break;
			}
			case 'C':
			case 'c':
			case 'S':
			case 's': {
				const per = cmd === 'C' || cmd === 'c' ? 6 : 4;
				if (nums.length === 0 || nums.length % per !== 0) throw new Error(`${cmd} needs groups of ${per} numbers`);
				const rel = cmd === 'c' || cmd === 's';
				for (let i = 0; i < nums.length; i += per) {
					const at = (k) => [nums[i + k] + (rel ? cur[0] : 0), nums[i + k + 1] + (rel ? cur[1] : 0)];
					let c1;
					let k = 0;
					if (per === 6) {
						c1 = at(0);
						k = 2;
					} else {
						c1 = lastC2 ? [2 * cur[0] - lastC2[0], 2 * cur[1] - lastC2[1]] : [cur[0], cur[1]];
					}
					const c2 = at(k);
					const p3 = at(k + 2);
					segs.push([cur, c1, c2, p3]);
					cur = p3;
					lastC2 = c2;
				}
				break;
			}
			default:
				throw new Error(`unsupported path command ${cmd}`);
		}
	}
	if (segs.length === 0) throw new Error('path has no curve');
	return segs;
}

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** flatten samples the cubic segments into a polyline (about 2 units apart), without repeated points. */
export function flatten(segs) {
	const pts = [segs[0][0]];
	for (const [p0, c1, c2, p3] of segs) {
		const n = Math.min(40, Math.max(4, Math.ceil((dist(p0, c1) + dist(c1, c2) + dist(c2, p3)) / 2)));
		for (let i = 1; i <= n; i++) {
			const t = i / n;
			const u = 1 - t;
			const a = u * u * u;
			const b = 3 * u * u * t;
			const c = 3 * u * t * t;
			const e = t * t * t;
			const p = i === n ? p3 : [a * p0[0] + b * c1[0] + c * c2[0] + e * p3[0], a * p0[1] + b * c1[1] + c * c2[1] + e * p3[1]];
			const last = pts[pts.length - 1];
			if (p[0] !== last[0] || p[1] !== last[1]) pts.push(p);
		}
	}
	return pts;
}

/** simplify is Douglas-Peucker with tolerance eps. */
function simplify(pts, eps) {
	if (pts.length < 3) return pts;
	const keep = new Array(pts.length).fill(false);
	keep[0] = keep[pts.length - 1] = true;
	const stack = [[0, pts.length - 1]];
	while (stack.length) {
		const [lo, hi] = stack.pop();
		let worst = 0;
		let at = -1;
		const [ax, ay] = pts[lo];
		const [bx, by] = pts[hi];
		const len = Math.hypot(bx - ax, by - ay);
		for (let i = lo + 1; i < hi; i++) {
			const d = len === 0 ? dist(pts[i], pts[lo]) : Math.abs((bx - ax) * (ay - pts[i][1]) - (ax - pts[i][0]) * (by - ay)) / len;
			if (d > worst) {
				worst = d;
				at = i;
			}
		}
		if (worst > eps && at > 0) {
			keep[at] = true;
			stack.push([lo, at], [at, hi]);
		}
	}
	return pts.filter((_, i) => keep[i]);
}

/** toData maps a KanjiVG point (109 box, y down) to the stroke-data box (1024, y up, baseline 900). */
export function toData([x, y]) {
	return [Math.round((x * 1024) / 109), Math.round(900 - (y * 1024) / 109)];
}

/** arcMidpoint is the point halfway along the polyline's length. */
function arcMidpoint(pts) {
	let total = 0;
	for (let i = 1; i < pts.length; i++) total += dist(pts[i - 1], pts[i]);
	let run = 0;
	for (let i = 1; i < pts.length; i++) {
		const seg = dist(pts[i - 1], pts[i]);
		if (run + seg >= total / 2) {
			const f = seg === 0 ? 0 : (total / 2 - run) / seg;
			return [pts[i - 1][0] + f * (pts[i][0] - pts[i - 1][0]), pts[i - 1][1] + f * (pts[i][1] - pts[i - 1][1])];
		}
		run += seg;
	}
	return pts[pts.length - 1];
}

/** outlinePolygon widens a polyline into the points of a closed shape: constant width, mitred joins, round caps. */
function outlinePolygon(pts, h) {
	const n = pts.length;
	const dirs = [];
	for (let i = 0; i < n - 1; i++) {
		const len = dist(pts[i], pts[i + 1]) || 1;
		dirs.push([(pts[i + 1][0] - pts[i][0]) / len, (pts[i + 1][1] - pts[i][1]) / len]);
	}
	const left = [];
	const right = [];
	for (let i = 0; i < n; i++) {
		const a = dirs[Math.max(0, i - 1)];
		const b = dirs[Math.min(n - 2, i)];
		let tx = a[0] + b[0];
		let ty = a[1] + b[1];
		const tl = Math.hypot(tx, ty);
		if (tl < 1e-9) {
			tx = b[0];
			ty = b[1];
		} else {
			tx /= tl;
			ty /= tl;
		}
		const cos = Math.max(0.6, a[0] * tx + a[1] * ty); // the mitre grows as 1/cos, capped at 1/0.6
		const nx = -ty;
		const ny = tx;
		const w = h / cos;
		left.push([pts[i][0] + nx * w, pts[i][1] + ny * w]);
		right.push([pts[i][0] - nx * w, pts[i][1] - ny * w]);
	}
	const cap = (centre, t, sign) => {
		const nx = -t[1];
		const ny = t[0];
		const out = [];
		for (let k = 1; k < 6; k++) {
			const th = (Math.PI * k) / 6;
			const c = Math.cos(th);
			const s = Math.sin(th);
			out.push([centre[0] + h * sign * (nx * c + t[0] * s), centre[1] + h * sign * (ny * c + t[1] * s)]);
		}
		return out;
	};
	const tEnd = dirs[n - 2];
	const tStart = dirs[0];
	// End cap: from the left side round the forward direction to the right side.
	const endCap = cap(pts[n - 1], tEnd, 1);
	// Start cap: from the right side round the backward direction to the left side.
	const startCap = cap(pts[0], tStart, -1);
	return [...left, ...endCap, ...right.reverse(), ...startCap];
}

/** strokeToData turns one KanjiVG path into a stroke-data outline path and median. */
export function strokeToData(d) {
	let pts = flatten(parsePath(d));
	if (pts.length < 2) pts = [pts[0], [pts[0][0] + 0.5, pts[0][1]]]; // a dot: give it a direction
	const med = simplify(pts, 0.7);
	if (med.length < 3 && pts.length >= 3) med.splice(1, 0, arcMidpoint(pts));
	const poly = outlinePolygon(simplify(pts, 0.2), HALF_WIDTH);
	const ring = [];
	for (const p of poly.map(toData)) {
		const last = ring[ring.length - 1];
		if (!last || last[0] !== p[0] || last[1] !== p[1]) ring.push(p);
	}
	const outline = `M${ring[0][0]} ${ring[0][1]}` + ring.slice(1).map(([x, y]) => ` L${x} ${y}`).join('') + ' Z';
	const median = [];
	for (const p of med.map(toData)) {
		const last = median[median.length - 1];
		if (!last || last[0] !== p[0] || last[1] !== p[1]) median.push(p);
	}
	if (median.length < 2) median.push([median[0][0] + 1, median[0][1]]);
	return { outline, median };
}

/** parseStrokes lists the d of every stroke path of a KanjiVG file, in stroke order (the -sN suffix). */
export function parseStrokes(svg) {
	const found = [];
	for (const m of svg.matchAll(/<path\b[^>]*>/g)) {
		const id = /\bid="kvg:[0-9a-f]+-s(\d+)"/.exec(m[0]);
		const d = /\bd="([^"]*)"/.exec(m[0]);
		if (id && d) found.push([Number(id[1]), d[1]]);
	}
	if (found.length === 0) throw new Error('no strokes');
	found.sort((a, b) => a[0] - b[0]);
	return found.map(([, d]) => d);
}

/** buildLine is the JSON line {"char", "data": {strokes, medians}} of one character. */
export function buildLine(char, svg) {
	const strokes = [];
	const medians = [];
	for (const d of parseStrokes(svg)) {
		const { outline, median } = strokeToData(d);
		strokes.push(outline);
		medians.push(median);
	}
	const line = JSON.stringify({ char, data: { strokes, medians } });
	if (Buffer.byteLength(line) > MAX_LINE_BYTES) throw new Error(`the line is ${Buffer.byteLength(line)} bytes, over the ${MAX_LINE_BYTES} the server accepts`);
	return line;
}

/** includeCodePoint: kana, kanji and the iteration marks; not Latin, punctuation or symbols. */
export function includeCodePoint(cp) {
	return (
		(cp >= 0x3005 && cp <= 0x3006) ||
		(cp >= 0x3041 && cp <= 0x3096) ||
		(cp >= 0x309d && cp <= 0x309f) ||
		(cp >= 0x30a1 && cp <= 0x30fa) ||
		(cp >= 0x30fc && cp <= 0x30ff) ||
		(cp >= 0x3400 && cp <= 0x4dbf) ||
		(cp >= 0x4e00 && cp <= 0x9fff) ||
		(cp >= 0xf900 && cp <= 0xfaff) ||
		(cp >= 0x20000 && cp <= 0x2fa1f)
	);
}

function usage(msg) {
	if (msg) console.error(msg);
	console.error('usage: node scripts/prepare-kanjivg-strokes.mjs <kanjivg>/kanji <out-dir> --version <tag> --commit <sha>');
	process.exit(2);
}

function fail(msg) {
	console.error(`prepare-kanjivg-strokes: ${msg}`);
	process.exit(1);
}

function main() {
	const args = process.argv.slice(2);
	const pos = [];
	const opts = {};
	for (let i = 0; i < args.length; i++) {
		if (args[i] === '--version' || args[i] === '--commit') {
			if (!args[i + 1]) usage(`${args[i]} needs a value`);
			opts[args[i].slice(2)] = args[++i];
		} else pos.push(args[i]);
	}
	if (pos.length !== 2 || !opts.version || !opts.commit) usage();
	const [kanjiDir, out] = pos;
	let names;
	try {
		names = readdirSync(kanjiDir)
			.filter((n) => /^[0-9a-f]{5}\.svg$/.test(n))
			.sort();
	} catch (e) {
		fail(`cannot read ${kanjiDir}: ${e.message}`);
	}
	const lines = [];
	for (const name of names) {
		const cp = parseInt(name.slice(0, 5), 16);
		if (!includeCodePoint(cp)) continue;
		try {
			lines.push([cp, buildLine(String.fromCodePoint(cp), readFileSync(join(kanjiDir, name), 'utf8'))]);
		} catch (e) {
			fail(`${name}: ${e.message}`);
		}
	}
	if (lines.length === 0) fail(`no usable kanji/<hex>.svg files in ${kanjiDir}`);
	lines.sort((a, b) => a[0] - b[0]);
	const jsonl = lines.map(([, l]) => l + '\n').join('');

	const notice =
		`Japanese stroke order from [KanjiVG](https://kanjivg.tagaini.net) ${opts.version} (commit ${opts.commit}), © Ulrich Apel, ` +
		'licensed [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/). The data was changed: each pen centre line was ' +
		'widened into an outline and reduced to a polyline, in the stroke-data format of Hanzi Writer. This pack is shared under the same licence.';
	const manifest = {
		id: PACK_ID,
		name: NAME,
		version: opts.version,
		type: 'strokes',
		languages: ['ja'],
		license: LICENSE,
		attribution: ATTRIBUTION,
		notice,
		format: FORMAT
	};
	const attribution = [
		`# ${NAME}`,
		'',
		`Stroke order for ${lines.length} characters (kana, kanji and iteration marks) derived from`,
		`[KanjiVG](https://kanjivg.tagaini.net), copyright Ulrich Apel, ${opts.version}, commit ${opts.commit}`,
		'(https://github.com/KanjiVG/kanjivg).',
		'',
		`Licence: ${LICENSE} (Creative Commons Attribution-Share Alike 3.0, the full text is in LICENSE).`,
		'',
		'What was changed: KanjiVG stores each stroke as the centre line of the pen. For the stroke-data format the app',
		'reads (Hanzi Writer, a 1024 box with the baseline at 900 and y up) every stroke path was sampled into a median',
		'(a short polyline) and widened by 2.75 KanjiVG units on each side with round caps into an outline.',
		'Stroke order and direction are KanjiVG\'s own; the variant drawings (-Kaisho, -Insatsu and so on) and everything',
		'that is not kana, a kanji or an iteration mark are not included. scripts/prepare-kanjivg-strokes.mjs reproduces',
		'the derivation. This adaptation is shared under the same licence, CC BY-SA 3.0.',
		''
	].join('\n');

	mkdirSync(out, { recursive: true });
	writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, '\t') + '\n');
	writeFileSync(join(out, 'strokes.jsonl.gz'), gzipSync(Buffer.from(jsonl, 'utf8'), { level: 9 }));
	writeFileSync(join(out, 'ATTRIBUTION.md'), attribution);
	console.log(`kanjivg-strokes: ${lines.length} characters written to ${out}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
