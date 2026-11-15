// Generates src/lib/writing/fixtures/strokes.json: stroke medians in unit coordinates and
// deterministic matcher cases. Shared with the Kotlin port (#38). Run: node scripts/make-writing-fixtures.mjs
//
// File format (also stated in the file's "format" field):
//   { "format": "...", "scale": 10000,
//     "chars": { "<char>": [[x0, y0, x1, y1, ...], ...] },   one flat array per stroke median
//     "cases": [ { "name", "char", "next", "ink": [x0, y0, ...], "expect": { "kind", "strokes"?, "reason"? } }, ... ] }
// Coordinates are integers: unit-box value x scale (0..1 across the pad, y down). One case per
// line. "expect.strokes" and "expect.reason", when present, must match exactly.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ink from './writing-ink-model.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHARS = ['了', '子', '糸', '纟', '红', '口', '十', '人', '永', '我', '好', '三', '川', '目', '王'];
// Parallel-stroke characters: a later stroke looks like the expected one, order matters.
const PARALLEL = ['三', '川', '目', '王'];

const r4 = (v) => Math.round(v * 1e4) / 1e4;
const pt = (x, y) => ({ x: r4(x), y: r4(y) });

function mulberry32(a) {
	return () => {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
const rnd = mulberry32(1);
const noise = (amp) => (rnd() * 2 - 1) * amp;

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const length = (ps) => ps.reduce((s, p, i) => (i ? s + dist(ps[i - 1], p) : 0), 0);
function resample(ps, n) {
	const total = length(ps);
	const out = [];
	let seg = 1;
	let acc = 0;
	for (let k = 0; k < n; k++) {
		const target = (total * k) / (n - 1);
		while (seg < ps.length - 1 && acc + dist(ps[seg - 1], ps[seg]) < target) {
			acc += dist(ps[seg - 1], ps[seg]);
			seg++;
		}
		const a = ps[seg - 1];
		const b = ps[seg];
		const l = dist(a, b);
		const t = l === 0 ? 0 : Math.min(1, Math.max(0, (target - acc) / l));
		out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
	}
	return out;
}
function centroid(ps) {
	return { x: ps.reduce((s, p) => s + p.x, 0) / ps.length, y: ps.reduce((s, p) => s + p.y, 0) / ps.length };
}
const draw = (median, amp = 0) =>
	resample(median, 24).map((p) => pt(p.x + noise(amp), p.y + noise(amp)));
const shift = (ps, dx, dy) => ps.map((p) => pt(p.x + dx, p.y + dy));
function scale(ps, f) {
	const c = centroid(ps);
	return ps.map((p) => pt(c.x + (p.x - c.x) * f, c.y + (p.y - c.y) * f));
}

const chars = {};
for (const ch of CHARS) {
	const data = JSON.parse(readFileSync(join(root, 'node_modules/hanzi-writer-data', `${ch}.json`), 'utf8'));
	chars[ch] = data.medians.map((m) => m.map(([x, y]) => pt(x / 1024, (900 - y) / 1024)));
}

const cases = [];
// A miss is reported as 'order' whenever the ink fits another stroke of the character, which
// takes precedence over the expected stroke's own failure. These cases do exactly that: 我's
// 撇 and 横 drawn backwards have the shape of its 提 and 撇, and the opposite-quadrant copies
// land on other strokes of 红, 我 and 好. The noisy hand copy of 红's last stroke fits no stroke
// at all, so only the miss is pinned.
const REASON = {
	'红 #0 opposite quadrant': 'order',
	'红 #2 opposite quadrant': 'order',
	'红 #3 opposite quadrant': 'order',
	'红 #4 opposite quadrant': 'order',
	'我 #0 reversed': 'order',
	'我 #0 opposite quadrant': 'order',
	'我 #1 reversed': 'order',
	'好 #0 opposite quadrant': 'order',
	'我 #0 hand: reversed': 'order',
	'我 #1 hand: reversed': 'order',
	'红 #1 hand: later stroke #4 drawn': null
};
const add = (name, char, next, ink, expect) => {
	if (name in REASON) {
		expect = { ...expect };
		if (REASON[name] === null) delete expect.reason;
		else expect.reason = REASON[name];
	}
	cases.push({ name, char, next, ink, expect });
};

for (const ch of CHARS) {
	const ms = chars[ch];
	ms.forEach((m, i) => {
		const tag = `${ch} #${i}`;
		add(`${tag} exact with noise`, ch, i, draw(m, 0.01), { kind: 'match', strokes: [i] });
		add(`${tag} shifted 0.15`, ch, i, shift(draw(m, 0.005), 0.15, 0.15), { kind: 'match', strokes: [i] });
		add(`${tag} scaled x0.6`, ch, i, scale(draw(m, 0.005), 0.6), { kind: 'match', strokes: [i] });
		add(`${tag} scaled x1.6`, ch, i, scale(draw(m, 0.005), 1.6), { kind: 'match', strokes: [i] });
		add(`${tag} reversed`, ch, i, draw(m).reverse(), { kind: 'miss', reason: 'direction' });
		if (i + 1 < ms.length) add(`${tag} next-but-one drawn`, ch, i, draw(ms[i + 1], 0.005), { kind: 'miss', reason: 'order' });
		if (length(m) > 0.3) {
			const c = centroid(m);
			add(`${tag} dot for a long stroke`, ch, i, shift(draw([{ x: 0, y: 0 }, { x: 0.05, y: 0.02 }]), c.x, c.y), { kind: 'miss' });
		}
		const c = centroid(m);
		const d = 0.45;
		add(`${tag} opposite quadrant`, ch, i, shift(draw(m), c.x < 0.5 ? d : -d, c.y < 0.5 ? d : -d), {
			kind: 'miss',
			reason: 'placement'
		});
		const zig = [];
		for (let k = 0; k < 8; k++) zig.push(pt(0.1 + rnd() * 0.8, 0.1 + rnd() * 0.8));
		add(`${tag} scribble`, ch, i, resample(zig, 24).map((p) => pt(p.x, p.y)), { kind: 'miss' });
	});
	if (PARALLEL.includes(ch)) {
		ms.forEach((m, i) => {
			const tag = `${ch} #${i}`;
			add(`${tag} sloppy but correct`, ch, i, draw(m, 0.02), { kind: 'match', strokes: [i] });
			for (let j = i + 1; j < ms.length; j++) {
				add(`${tag} later stroke #${j} drawn`, ch, i, draw(ms[j], 0.01), { kind: 'miss', reason: 'order' });
			}
		});
	}
	add(`${ch} tap`, ch, 0, [pt(0.5, 0.5), pt(0.505, 0.5)], { kind: 'ignored' });
}

const joined = (ch, a, b) => draw(chars[ch].slice(a, b + 1).flat(), 0.005);
add('了 0+1 in one motion', '了', 0, joined('了', 0, 1), { kind: 'match', strokes: [0, 1] });
for (const ch of ['子', '糸', '纟', '红']) {
	add(`${ch} 0+1 in one motion`, ch, 0, joined(ch, 0, 1), { kind: 'match', strokes: [0, 1] });
}
add('口 1+2 do not join', '口', 1, joined('口', 1, 2), { kind: 'miss' });

// Joins must not swallow or invent strokes: a single stroke drawn on its own is credited as that
// stroke only, even when the next stroke is short or starts where it ends; a long stroke drawn
// backwards never passes as a join of strokes running the other way.
const JOINY = ['通', '张', '东', '新', '别', '回', '等', '第', '高', '却'];
for (const ch of JOINY) {
	const data = JSON.parse(readFileSync(join(root, 'node_modules/hanzi-writer-data', `${ch}.json`), 'utf8'));
	chars[ch] = data.medians.map((m) => m.map(([x, y]) => pt(x / 1024, (900 - y) / 1024)));
	chars[ch].forEach((m, i) => {
		add(`${ch} #${i} alone is not a join`, ch, i, draw(m, 0.003), { kind: 'match', strokes: [i] });
		add(`${ch} #${i} reversed is no join`, ch, i, draw(m, 0.003).reverse(), { kind: 'miss' });
	});
}

// Hand-model cases (writing-ink-model.mjs): how real hands draw, so the forgiving rules stay
// pinned — simplified straight lines, smooth wobble with over/undershoot and rotation, pointer
// jitter, hooks left off or exaggerated, rounded corners, shifted and scaled strokes. Wrong
// strokes drawn by the same hand must still miss.
const HAND = ['好', '女', '子', '了', '我', '永', '红', '口', '十', '人'];
const handChars = {};
for (const ch of HAND) {
	if (!chars[ch]) {
		const data = JSON.parse(readFileSync(join(root, 'node_modules/hanzi-writer-data', `${ch}.json`), 'utf8'));
		chars[ch] = data.medians.map((m) => m.map(([x, y]) => pt(x / 1024, (900 - y) / 1024)));
	}
	handChars[ch] = chars[ch];
}
const hr = ink.mulberry32(20261115);
// At most 40 points: thin evenly (keeping both ends) so pointer jitter keeps its roughness.
const round = (ps) => {
	const step = Math.ceil(ps.length / 40);
	const kept = ps.filter((_, k) => k % step === 0);
	if (kept.at(-1) !== ps.at(-1)) kept.push(ps.at(-1));
	if (kept.length > 40) kept.splice(-2, 1);
	return kept.map((p) => pt(p.x, p.y));
};
for (const ch of HAND) {
	const ms = handChars[ch];
	ms.forEach((m, i) => {
		const tag = `${ch} #${i} hand`;
		for (const [label, drawn] of ink.correctVariants(m, hr, 2)) {
			add(`${tag}: ${label}`, ch, i, round(drawn), { kind: 'match', strokes: [i] });
		}
		add(`${tag}: reversed`, ch, i, round(ink.hand(m, hr).reverse()), { kind: 'miss', reason: 'direction' });
		for (let j = i + 1; j < ms.length; j++) {
			add(`${tag}: later stroke #${j} drawn`, ch, i, round(ink.hand(ms[j], hr)), { kind: 'miss', reason: 'order' });
		}
		if (i > 0) {
			add(`${tag}: earlier stroke #${i - 1} drawn again`, ch, i, round(ink.hand(ms[i - 1], hr)), { kind: 'miss', reason: 'order' });
		}
	});
}
const hz = handChars['好'];
add('好 #3+#4 hand: 子 top joined in one motion', '好', 3, round(ink.hand([...hz[3], ...hz[4]], hr, { amp: 0.02, endFrac: 0.08, rotDeg: 5 })), {
	kind: 'match',
	strokes: [3, 4]
});

const SCALE = 10000;
const flat = (ps) => ps.flatMap((p) => [Math.round(p.x * SCALE), Math.round(p.y * SCALE)]);
for (const c of cases) if (c.ink.length > 40) throw new Error(`${c.name}: ${c.ink.length} points`);
const FORMAT =
	'chars: per character, one flat [x0,y0,x1,y1,...] array per stroke median; cases: ink is a flat array the same way; ' +
	'all coordinates are integers = unit-box value x scale (0..1 across the pad, y down). expect.kind is match|miss|ignored; ' +
	'expect.strokes and expect.reason, when present, must equal the result. One case per line.';
const lines = [
	'{"format":' + JSON.stringify(FORMAT) + ',"scale":' + SCALE + ',',
	'"chars":' + JSON.stringify(Object.fromEntries(Object.entries(chars).map(([ch, ms]) => [ch, ms.map(flat)]))) + ',',
	'"cases":[',
	cases.map((c) => JSON.stringify({ name: c.name, char: c.char, next: c.next, ink: flat(c.ink), expect: c.expect })).join(',\n'),
	']}'
];
writeFileSync(join(root, 'src/lib/writing/fixtures/strokes.json'), lines.join('\n') + '\n');
console.log(`wrote ${cases.length} cases`);
