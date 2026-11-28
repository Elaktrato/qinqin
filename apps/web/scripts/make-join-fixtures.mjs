// Generates src/lib/writing/fixtures/joins.json (#292): the joined-stroke cases of the writing matcher on real
// Japanese stroke data (KanjiVG), shared with the Kotlin port like fixtures/strokes.json. Needs a KanjiVG checkout
// (the tag scripts/fetch-kanjivg-strokes.sh pins):
//
//   node scripts/make-join-fixtures.mjs <kanjivg>/kanji            writes the fixture
//   node scripts/make-join-fixtures.mjs <kanjivg>/kanji --report   prints the end-to-start gaps of every kana pair
//
// The medians are made exactly as the kanjivg-strokes pack makes them (scripts/prepare-kanjivg-strokes.mjs), so the
// fixture is an adaptation of KanjiVG and stays under CC BY-SA 3.0 (fixtures/README.md). It is test data only.
//
// File format (also stated in the file's "format" field): as fixtures/strokes.json (flat integer arrays, unit value x
// scale, y down), plus "links": per character, one entry per consecutive stroke pair, what the matcher's joinLink must
// answer ("near": the gap rule, "flow": the flow rule, null: no join). The links are this project's expectations,
// written out below, not computed from the matcher.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildLine } from '../../../scripts/prepare-kanjivg-strokes.mjs';
import * as ink from './writing-ink-model.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCALE = 10000;
const SOURCE = 'KanjiVG r20260714 (commit d95a976), © Ulrich Apel, CC BY-SA 3.0; medians as scripts/prepare-kanjivg-strokes.mjs makes them';

/** The expected link of each consecutive stroke pair (stroke k to k+1, numbered from 1 in the comments). */
const LINKS = {
	// Kana: the hook or flick of the joined stroke points at the next start.
	き: [null, null, 'flow'], // 3+4: the hooked diagonal into the bottom curve
	さ: [null, 'flow'], // 2+3
	ふ: ['near', 'flow', 'flow'], // 1+2 within 0.2; 2+3 and 3+4: each dot flicks towards the next
	こ: ['flow'],
	た: [null, null, 'flow'], // 3+4: the こ part
	い: ['flow'],
	う: ['flow'],
	け: ['flow', null],
	に: ['flow', 'flow'],
	シ: [null, 'flow'],
	ン: ['flow'],
	ち: [null], // the horizontal ends pointing away from the second stroke (0.201 away: just over the gap rule)
	// Kanji: the gap rule (子 1+2, 糸 2+3, 以 1+2) and the flow rule (小 1+2, 心 3+4, 以 2+3).
	小: ['flow', null],
	心: [null, null, 'flow'],
	以: ['near', 'flow', null, null],
	子: ['near', null],
	糸: [null, 'near', null, null, null],
	女: [null, null]
};

/** Skip-one joins expected to miss (the issue's き 1+3, and the same mistake on the other characters). */
const SKIPS = { き: [0], さ: [0], た: [1], に: [0], 心: [0, 1], 以: [0], 子: [0] };

function medians(dir, ch) {
	const name = `${ch.codePointAt(0).toString(16).padStart(5, '0')}.svg`;
	const { data } = JSON.parse(buildLine(ch, readFileSync(join(dir, name), 'utf8')));
	return data.medians.map((m) => m.map(([x, y]) => ({ x: x / 1024, y: (900 - y) / 1024 })));
}

const flat = (ps) => ps.flatMap((p) => [Math.round(p.x * SCALE), Math.round(p.y * SCALE)]);
const gapOf = (a, b) => Math.hypot(b[0].x - a.at(-1).x, b[0].y - a.at(-1).y);

/** The joined ink a hand draws: the strokes in one motion, the move between them curving on from the first's end. */
function rounded(a, b) {
	const end = a.at(-1);
	const before = a[Math.max(0, a.length - 2)];
	const l = Math.hypot(end.x - before.x, end.y - before.y) || 1;
	const g = gapOf(a, b);
	const c = { x: end.x + ((end.x - before.x) / l) * g * 0.4, y: end.y + ((end.y - before.y) / l) * g * 0.4 };
	const s = b[0];
	const bridge = [];
	for (let i = 1; i < 8; i++) {
		const t = i / 8;
		const u = 1 - t;
		bridge.push({ x: u * u * end.x + 2 * u * t * c.x + t * t * s.x, y: u * u * end.y + 2 * u * t * c.y + t * t * s.y });
	}
	return [...a, ...bridge, ...b];
}

function report(dir) {
	const rows = [];
	for (let cp = 0x3041; cp <= 0x30fa; cp++) {
		if (cp > 0x3096 && cp < 0x30a1) continue;
		const ch = String.fromCodePoint(cp);
		let ms;
		try {
			ms = medians(dir, ch);
		} catch {
			continue;
		}
		for (let k = 0; k + 1 < ms.length; k++) rows.push(`${ch}\t${k + 1}+${k + 2}\t${gapOf(ms[k], ms[k + 1]).toFixed(3)}`);
	}
	console.log(`kana stroke pairs: ${rows.length}; end-to-start gap in the unit box:`);
	console.log(rows.join('\n'));
}

function main() {
	const [dir, flag] = process.argv.slice(2);
	if (!dir) {
		console.error('usage: node scripts/make-join-fixtures.mjs <kanjivg>/kanji [--report]');
		process.exit(2);
	}
	if (flag === '--report') return report(dir);
	const chars = {};
	const cases = [];
	const rnd = ink.mulberry32(292);
	for (const [ch, links] of Object.entries(LINKS)) {
		const ms = medians(dir, ch);
		if (links.length !== ms.length - 1) throw new Error(`${ch}: ${ms.length} strokes, ${links.length} links`);
		chars[ch] = ms.map(flat);
		ms.forEach((m, k) => cases.push({ name: `${ch} stroke ${k + 1} on its own`, char: ch, next: k, ink: flat(m), expect: { kind: 'match', strokes: [k] } }));
		links.forEach((link, k) => {
			const a = ms[k];
			const b = ms[k + 1];
			const pair = `${ch} ${k + 1}+${k + 2}`;
			if (link === null) {
				cases.push({ name: `${pair} drawn in one motion: not a join`, char: ch, next: k, ink: flat(ink.resample([...a, ...b], 40)), expect: { kind: 'miss' } });
				return;
			}
			const both = { kind: 'match', strokes: [k, k + 1] };
			cases.push({ name: `${pair} in one motion, straight across`, char: ch, next: k, ink: flat(ink.resample([...a, ...b], 40)), expect: both });
			cases.push({ name: `${pair} in one motion, curving on`, char: ch, next: k, ink: flat(ink.resample(rounded(a, b), 40)), expect: both });
			const hand = ink.hand(rounded(a, b), rnd, { amp: 0.01, endFrac: 0.03, rotDeg: 3, jitter: 0.003 });
			cases.push({ name: `${pair} in one motion, by hand`, char: ch, next: k, ink: flat(hand), expect: both });
			cases.push({ name: `${pair} in one motion, backwards`, char: ch, next: k, ink: flat(ink.resample([...a, ...b], 40).reverse()), expect: { kind: 'miss' } });
			if (k > 0) cases.push({ name: `${pair} in one motion, before stroke ${k}`, char: ch, next: k - 1, ink: flat(ink.resample([...a, ...b], 40)), expect: { kind: 'miss' } });
		});
		for (const k of SKIPS[ch] ?? []) {
			cases.push({ name: `${ch} ${k + 1}+${k + 3} in one motion (stroke ${k + 2} left out)`, char: ch, next: k, ink: flat(ink.resample([...ms[k], ...ms[k + 2]], 40)), expect: { kind: 'miss' } });
		}
	}
	const format =
		'As strokes.json: chars per character, one flat [x0,y0,x1,y1,...] array per stroke median; cases with ink flat the same way; coordinates are integers = unit-box value x scale (0..1 across the pad, y down); expect.kind match|miss, expect.strokes when present must equal the result. links: per character, one entry per consecutive stroke pair (k to k+1), what joinLink answers: "near" (gap rule), "flow" (flow rule) or null. Source: see "source"; one case per line.';
	const lines = [
		'{',
		`"format": ${JSON.stringify(format)},`,
		`"source": ${JSON.stringify(SOURCE)},`,
		`"scale": ${SCALE},`,
		`"links": ${JSON.stringify(LINKS)},`,
		`"chars": ${JSON.stringify(chars)},`,
		'"cases": [',
		cases.map((c) => JSON.stringify(c)).join(',\n'),
		']',
		'}'
	];
	writeFileSync(join(root, 'src/lib/writing/fixtures/joins.json'), lines.join('\n') + '\n');
	console.log(`joins.json: ${Object.keys(chars).length} characters, ${cases.length} cases`);
}

main();
