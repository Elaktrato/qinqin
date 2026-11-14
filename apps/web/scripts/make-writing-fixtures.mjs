// Generates src/lib/writing/fixtures/strokes.json: stroke medians in unit coordinates and
// deterministic matcher cases. Shared with the Kotlin port (#38). Run: node scripts/make-writing-fixtures.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHARS = ['了', '子', '糸', '纟', '红', '口', '十', '人', '永', '我', '好'];

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
const add = (name, char, next, ink, expect) => cases.push({ name, char, next, ink, expect });

for (const ch of CHARS) {
	const ms = chars[ch];
	ms.forEach((m, i) => {
		const tag = `${ch} #${i}`;
		add(`${tag} exact with noise`, ch, i, draw(m, 0.01), { kind: 'match', strokes: [i] });
		add(`${tag} shifted 0.15`, ch, i, shift(draw(m, 0.005), 0.15, 0.15), { kind: 'match', strokes: [i] });
		add(`${tag} scaled x0.6`, ch, i, scale(draw(m, 0.005), 0.6), { kind: 'match', strokes: [i] });
		add(`${tag} scaled x1.6`, ch, i, scale(draw(m, 0.005), 1.6), { kind: 'match', strokes: [i] });
		add(`${tag} reversed`, ch, i, draw(m).reverse(), { kind: 'miss', reason: 'direction' });
		if (i + 1 < ms.length) add(`${tag} next-but-one drawn`, ch, i, draw(ms[i + 1], 0.005), { kind: 'miss' });
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
	add(`${ch} tap`, ch, 0, [pt(0.5, 0.5), pt(0.505, 0.5)], { kind: 'ignored' });
}

const joined = (ch, a, b) => draw(chars[ch].slice(a, b + 1).flat(), 0.005);
add('了 0+1 in one motion', '了', 0, joined('了', 0, 1), { kind: 'match', strokes: [0, 1] });
for (const ch of ['子', '糸', '纟', '红']) {
	add(`${ch} 0+1 in one motion`, ch, 0, joined(ch, 0, 1), { kind: 'match', strokes: [0, 1] });
}
add('口 1+2 do not join', '口', 1, joined('口', 1, 2), { kind: 'miss' });

writeFileSync(join(root, 'src/lib/writing/fixtures/strokes.json'), JSON.stringify({ chars, cases }) + '\n');
console.log(`wrote ${cases.length} cases`);
