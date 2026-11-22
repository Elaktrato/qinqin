// Generates the `generated` block of docs/contracts/events/review-replace.json
// (#131 review fix 5): random families of reviews (forks, chains, cycles,
// dangling and invalid references, other cards, workspaces and seconds,
// shuffled) with the ids that count, computed by an oracle written from the
// rule text (graph search over the links), independent of the web and Go
// implementations. Deterministic: a fixed seed and a seeded PRNG.
//
//   node scripts/contracts/gen-review-replace.mjs          rewrites the block
//   node scripts/contracts/gen-review-replace.mjs --check  exit 1 when it differs

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FILE = resolve(dirname(fileURLToPath(import.meta.url)), '../../docs/contracts/events/review-replace.json');
const SEED = 131;
const COUNT = 300;

// mulberry32
function prng(seed) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
const rnd = prng(SEED);
const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
const pick = (list) => list[Math.floor(rnd() * list.length)];

const TS = [
	'2026-11-22T09:00:00Z',
	'2026-11-22T09:00:00.999Z',
	'2026-11-22T10:00:00.5+01:00',
	'2026-11-22T09:00:01Z',
	'2026-11-22T08:59:59.999Z',
	'not a time'
];
const id = (n) => `01KAPZ${String(n).padStart(20, '0')}`;

function makeCase() {
	const size = int(1, 7);
	const ids = [...new Set(Array.from({ length: size }, () => id(int(0, 40))))];
	const events = ids.map((evId) => {
		const payload = { cardId: pick(['c1', 'c1', 'c1', 'c1', 'c1', 'c1', 'c1', 'c2']), mode: 'vocab', grade: pick([1, 2, 3, 4, 1, 2, 3, 4, 0, 2.5]) };
		const r = rnd();
		if (r < 0.8) payload.replaces = pick([...ids, ...ids, id(99), '']);
		else if (r < 0.83) payload.replaces = 5;
		return {
			id: evId,
			workspaceId: pick([7, 7, 7, 7, 7, 7, 7, 8]),
			device: 'web',
			ts: pick([...Array(6).fill(TS.slice(0, 3)).flat(), ...TS.slice(3)]),
			type: pick(['review', 'review', 'review', 'review', 'review', 'review', 'review', 'review', 'review', 'read']),
			payload
		};
	});
	for (let i = events.length - 1; i > 0; i--) {
		const j = Math.floor(rnd() * (i + 1));
		[events[i], events[j]] = [events[j], events[i]];
	}
	return events;
}

// The oracle, from the rule text: valid reviews; links (same workspace, card,
// whole second; not itself); components by graph search; the greatest id lives.
function oracle(events) {
	const valid = events.filter((e) => {
		const p = e.payload;
		return (
			e.type === 'review' &&
			typeof p === 'object' && p !== null &&
			typeof p.cardId === 'string' && p.cardId !== '' &&
			Number.isInteger(p.grade) && p.grade >= 1 && p.grade <= 4 &&
			!Number.isNaN(Date.parse(e.ts))
		);
	});
	const byId = new Map(valid.map((e) => [e.id, e]));
	const second = (e) => Math.floor(Date.parse(e.ts) / 1000);
	const edges = new Map(valid.map((e) => [e.id, []]));
	for (const e of valid) {
		const ref = e.payload.replaces;
		if (typeof ref !== 'string' || ref === '' || ref === e.id) continue;
		const t = byId.get(ref);
		if (!t || t.workspaceId !== e.workspaceId || t.payload.cardId !== e.payload.cardId || second(t) !== second(e)) continue;
		edges.get(e.id).push(t.id);
		edges.get(t.id).push(e.id);
	}
	const seen = new Set();
	const replaced = [];
	for (const start of byId.keys()) {
		if (seen.has(start)) continue;
		const family = [];
		const stack = [start];
		seen.add(start);
		while (stack.length > 0) {
			const at = stack.pop();
			family.push(at);
			for (const next of edges.get(at)) if (!seen.has(next)) (seen.add(next), stack.push(next));
		}
		const top = family.reduce((a, b) => (b > a ? b : a));
		for (const member of family) if (member !== top) replaced.push(member);
	}
	const gone = new Set(replaced);
	const live = valid
		.filter((e) => !gone.has(e.id))
		.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
		.map((e) => e.id);
	return { live, replaced: replaced.sort() };
}

const generated = {
	generator: 'scripts/contracts/gen-review-replace.mjs',
	seed: SEED,
	note: 'random families (seeded): the same rule as the hand-written cases; live and replaced from an independent oracle',
	cases: Array.from({ length: COUNT }, () => {
		const events = makeCase();
		return { events, ...oracle(events) };
	})
};

const current = readFileSync(FILE, 'utf8');
const fixture = JSON.parse(current);
fixture.generated = generated;
// Hand-written cases stay indented; each generated case is one line.
const head = JSON.stringify({ ...fixture, generated: undefined }, null, 2).replace(/\n}$/, '');
const block =
	`,\n  "generated": {\n    "generator": ${JSON.stringify(generated.generator)},\n    "seed": ${SEED},\n    "note": ${JSON.stringify(generated.note)},\n    "cases": [\n` +
	generated.cases.map((c) => '      ' + JSON.stringify(c)).join(',\n') +
	'\n    ]\n  }\n}\n';
const next = head + block;
if (process.argv.includes('--check')) {
	if (next !== current) {
		console.error('review-replace.json: the generated block is out of date');
		process.exit(1);
	}
} else {
	writeFileSync(FILE, next);
}
