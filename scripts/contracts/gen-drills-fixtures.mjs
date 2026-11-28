#!/usr/bin/env node
// Generates docs/contracts/drills/schedule.json (each drill item's schedule and
// retrievability, replayed from its answers) and docs/contracts/drills/pick.json
// (a drill's round and the "practise weakest" round) from PLAIN ts-fsrs, as an
// oracle that shares no code with the project: the answer rules, the study
// clock (frozen runs of whole days) and the picks are written here again from
// the rule text in docs/contracts/drills/README.md.
//
//   node scripts/contracts/gen-drills-fixtures.mjs          write the files
//   node scripts/contracts/gen-drills-fixtures.mjs --check  exit 1 when they differ
//
// ts-fsrs is read from apps/web/node_modules (run `npm --prefix apps/web ci` first).

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const dir = join(root, 'docs', 'contracts', 'drills');
const tsfsrsDir = join(root, 'apps', 'web', 'node_modules', 'ts-fsrs');
if (!existsSync(tsfsrsDir)) {
	console.error('ts-fsrs not found: run `npm --prefix apps/web ci` first');
	process.exit(2);
}
const { createEmptyCard, fsrs, Rating, default_w, forgetting_curve } = await import(pathToFileURL(join(tsfsrsDir, 'dist', 'index.mjs')).href);
const version = JSON.parse(readFileSync(join(tsfsrsDir, 'package.json'), 'utf8')).version;

const DAY = 86_400_000;
const RATING = { 1: Rating.Again, 2: Rating.Hard, 3: Rating.Good, 4: Rating.Easy };
const ROUND_SIZE = 20;
const NEW_PER_ROUND = 10;
const WS = 7;
const ms = (iso) => Date.parse(iso);
const iso = (t) => new Date(t).toISOString().replace('.000Z', 'Z');
const round8 = (x) => Math.round(x * 1e8) / 1e8;

// ---- the rules, written again from the README ----

const ID = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
function validId(id) {
	return typeof id === 'string' && id.length <= 32 && ID.test(id) && id !== 'weakest';
}
function validMode(mode) {
	return typeof mode === 'string' && mode.length <= 32 && ID.test(mode);
}
function validItem(item) {
	if (typeof item !== 'string') return false;
	const n = [...item].length;
	return n >= 1 && n <= 200 && !/[\p{White_Space}\p{Cc}]/u.test(item);
}
function answerOf(e) {
	if (e.workspaceId !== WS || typeof e.type !== 'string' || !e.type.startsWith('drill.')) return null;
	const drill = e.type.slice('drill.'.length);
	if (!validId(drill)) return null;
	const p = e.payload;
	if (typeof p !== 'object' || p === null || Array.isArray(p)) return null;
	if (!validItem(p.item) || !validMode(p.mode) || ![1, 2, 3, 4].includes(p.grade)) return null;
	const at = ms(e.ts);
	if (Number.isNaN(at)) return null;
	return { id: e.id, drill, item: p.item, grade: p.grade, at };
}

/** The study clock of runs [{a, n}]: v(t) and its inverse. */
function clockOf(runs) {
	const rs = runs.map((r) => ({ a: ms(r.a), n: r.days })).sort((x, y) => x.a - y.a);
	return {
		v: (t) => rs.reduce((out, r) => out - Math.min(Math.max(t - r.a, 0), r.n * DAY), t),
		inverse: (x) => rs.reduce((t, r) => (t >= r.a ? t + r.n * DAY : t), x)
	};
}

const scheduler = fsrs({ w: [...default_w] });

/** Every item's state: drill -> item -> {due, stability, difficulty, state, answers, fed}. */
function states(events, clock) {
	const answers = events.map(answerOf).filter((a) => a !== null);
	answers.sort((x, y) => x.at - y.at || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
	const out = new Map();
	for (const a of answers) {
		const key = `${a.drill}\u0000${a.item}`;
		let s = out.get(key);
		const v = clock.v(a.at);
		if (s === undefined) {
			s = { drill: a.drill, item: a.item, card: createEmptyCard(new Date(v)), fed: -Infinity, answers: 0 };
			out.set(key, s);
		}
		const fed = Math.max(v, s.fed);
		s.card = scheduler.next(s.card, new Date(fed), RATING[a.grade]).card;
		s.fed = fed;
		s.answers += 1;
	}
	return out;
}
function retrievability(s, now, clock) {
	const elapsed = Math.max(0, clock.v(now) - s.fed) / DAY;
	return forgetting_curve([...default_w], elapsed, s.card.stability);
}
function view(s, now, clock) {
	return {
		drill: s.drill,
		item: s.item,
		due: iso(clock.inverse(s.card.due.getTime())),
		stability: round8(s.card.stability),
		difficulty: round8(s.card.difficulty),
		state: s.card.state,
		answers: s.answers,
		retrievability: round8(retrievability(s, now, clock))
	};
}
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function roundOf(drill, items, events, now, clock) {
	const all = states(events, clock);
	const seen = [];
	const fresh = [];
	for (const item of items) {
		const s = all.get(`${drill}\u0000${item}`);
		if (s === undefined) fresh.push(item);
		else seen.push({ item, due: clock.inverse(s.card.due.getTime()), r: retrievability(s, now, clock) });
	}
	const due = seen.filter((s) => s.due <= now).sort((a, b) => a.due - b.due || cmp(a.item, b.item));
	const ahead = seen.filter((s) => s.due > now).sort((a, b) => a.r - b.r || a.due - b.due || cmp(a.item, b.item));
	const out = [];
	for (const s of due) if (out.length < ROUND_SIZE) out.push({ item: s.item, why: 'due' });
	let added = 0;
	for (const item of fresh) {
		if (out.length >= ROUND_SIZE || added >= NEW_PER_ROUND) break;
		out.push({ item, why: 'new' });
		added++;
	}
	for (const s of ahead) if (out.length < ROUND_SIZE) out.push({ item: s.item, why: 'ahead' });
	return out;
}

function weakestOf(candidates, events, now, clock) {
	const all = states(events, clock);
	const list = [];
	for (const c of candidates) {
		for (const item of new Set(c.items)) {
			const s = all.get(`${c.drill}\u0000${item}`);
			if (s !== undefined) list.push({ drill: c.drill, item, r: retrievability(s, now, clock) });
		}
	}
	list.sort((a, b) => a.r - b.r || cmp(a.drill, b.drill) || cmp(a.item, b.item));
	return list.slice(0, ROUND_SIZE).map(({ drill, item }) => ({ drill, item }));
}

// ---- the cases ----

let seq = 0;
function ev(drill, item, grade, ts, extra = {}) {
	seq++;
	return {
		id: `01KB000000000000000000${String(seq).padStart(4, '0')}`,
		workspaceId: WS,
		device: 'web',
		ts,
		type: `drill.${drill}`,
		payload: { item, mode: 'produce', grade },
		...extra
	};
}

const scheduleCases = [
	{
		name: 'one Good answer: learning, due after the second learning step',
		now: '2026-11-28T08:05:00Z',
		events: [ev('tone-pairs', '3-4', 3, '2026-11-28T08:00:00Z')]
	},
	{
		name: 'Again, then Good twice: into review',
		now: '2026-11-29T08:00:00Z',
		events: [
			ev('tone-pairs', '3-4', 1, '2026-11-28T08:00:00Z'),
			ev('tone-pairs', '3-4', 3, '2026-11-28T08:01:30Z'),
			ev('tone-pairs', '3-4', 3, '2026-11-28T08:12:00Z')
		]
	},
	{
		name: 'answers over weeks, a lapse, and the retrievability a month later',
		now: '2027-01-15T09:00:00Z',
		events: [
			ev('conjugation', '1234:te-form', 3, '2026-11-01T08:00:00Z'),
			ev('conjugation', '1234:te-form', 3, '2026-11-01T08:10:00Z'),
			ev('conjugation', '1234:te-form', 3, '2026-11-04T08:00:00Z'),
			ev('conjugation', '1234:te-form', 1, '2026-11-20T08:00:00Z'),
			ev('conjugation', '1234:te-form', 2, '2026-11-20T08:10:00Z'),
			ev('conjugation', '1234:te-form', 4, '2026-11-25T08:00:00Z')
		]
	},
	{
		name: 'the log order does not matter: answers replay by time, then id',
		now: '2026-11-30T08:00:00Z',
		events: (() => {
			const a = ev('counters', '5678', 3, '2026-11-28T08:00:00Z');
			const b = ev('counters', '5678', 1, '2026-11-28T08:00:00Z');
			const c = ev('counters', '5678', 3, '2026-11-27T08:00:00Z');
			return [b, a, c];
		})()
	},
	{
		name: 'the same item key in two drills, and two items of one drill, are separate schedules',
		now: '2026-11-29T08:00:00Z',
		events: [
			ev('tone-pairs', 'x', 3, '2026-11-28T08:00:00Z'),
			ev('look-alikes', 'x', 1, '2026-11-28T08:00:00Z'),
			ev('tone-pairs', 'y', 4, '2026-11-28T09:00:00Z')
		]
	},
	{
		name: 'answers that are not answers, another workspace and other types are left out',
		now: '2026-11-29T08:00:00Z',
		events: [
			ev('tone-pairs', '1-1', 3, '2026-11-28T08:00:00Z'),
			ev('tone-pairs', '1-1', 7, '2026-11-28T08:05:00Z'),
			ev('tone-pairs', '1-1', 1, '2026-11-28T08:06:00Z', { workspaceId: 8 }),
			ev('tone-pairs', '1 1', 1, '2026-11-28T08:07:00Z'),
			ev('tone-pairs', '1-1', 1, '2026-11-28T08:08:00Z', { type: 'review' })
		]
	},
	{
		name: 'a frozen vacation run between answers: the days do not count and the due moves past it',
		now: '2026-12-20T08:00:00Z',
		clock: [{ a: '2026-11-05T00:00:00Z', days: 4 }],
		events: [
			ev('tone-pairs', '2-3', 3, '2026-11-01T08:00:00Z'),
			ev('tone-pairs', '2-3', 3, '2026-11-01T08:10:00Z'),
			ev('tone-pairs', '2-3', 3, '2026-11-03T08:00:00Z'),
			ev('tone-pairs', '2-3', 3, '2026-11-12T08:00:00Z')
		]
	}
];

seq = 1000;
const t0 = '2026-11-28T08:00:00Z';
const pickCases = [
	{
		name: 'a fresh drill: new items in the drill order, at most 10',
		now: '2026-11-28T09:00:00Z',
		drill: 'tone-pairs',
		items: Array.from({ length: 12 }, (_, i) => `n${String(i + 1).padStart(2, '0')}`),
		events: []
	},
	{
		name: 'due first (earliest due first), then new, then the rest by lowest retrievability',
		now: '2026-12-10T08:00:00Z',
		drill: 'tone-pairs',
		items: ['a', 'b', 'c', 'd', 'e', 'f'],
		events: [
			ev('tone-pairs', 'a', 3, '2026-11-28T08:00:00Z'),
			ev('tone-pairs', 'b', 1, '2026-12-09T08:00:00Z'),
			ev('tone-pairs', 'c', 4, '2026-11-01T08:00:00Z'),
			ev('tone-pairs', 'c', 4, '2026-11-20T08:00:00Z'),
			ev('tone-pairs', 'd', 4, '2026-12-10T07:59:00Z'),
			ev('tone-pairs', 'd', 4, '2026-12-10T07:59:30Z'),
			ev('tone-pairs', 'e', 4, '2026-12-01T08:00:00Z'),
			ev('tone-pairs', 'e', 4, '2026-12-05T08:00:00Z')
		]
	},
	{
		name: 'answered items that are no longer candidates are not picked; other drills do not count',
		now: '2026-11-29T08:00:00Z',
		drill: 'counters',
		items: ['kept'],
		events: [
			ev('counters', 'gone', 1, t0),
			ev('counters', 'kept', 1, t0),
			ev('tone-pairs', 'kept', 4, t0)
		]
	},
	{
		name: 'at most 20, due items first even beyond the new limit',
		now: '2026-12-01T08:00:00Z',
		drill: 'conjugation',
		items: [...Array.from({ length: 18 }, (_, i) => `d${String(i + 1).padStart(2, '0')}`), 'n1', 'n2', 'n3', 'n4'],
		events: Array.from({ length: 18 }, (_, i) => ev('conjugation', `d${String(i + 1).padStart(2, '0')}`, 1, `2026-11-28T08:${String(i).padStart(2, '0')}:00Z`))
	}
];

seq = 2000;
const weakestCases = [
	{
		name: 'across drills, lowest retrievability first; unseen items are not weak',
		now: '2026-12-10T08:00:00Z',
		candidates: [
			{ drill: 'tone-pairs', items: ['3-4', '2-3', '1-1', 'unseen'] },
			{ drill: 'counters', items: ['5678', '9012'] }
		],
		events: [
			ev('tone-pairs', '3-4', 1, '2026-12-01T08:00:00Z'),
			ev('tone-pairs', '2-3', 4, '2026-12-09T08:00:00Z'),
			ev('tone-pairs', '1-1', 3, '2026-11-20T08:00:00Z'),
			ev('tone-pairs', '1-1', 3, '2026-11-20T08:10:00Z'),
			ev('counters', '5678', 2, '2026-11-25T08:00:00Z'),
			ev('counters', '9012', 4, '2026-12-10T07:00:00Z')
		]
	},
	{
		name: 'equal histories: the drill id, then the item key, decides',
		now: '2026-11-30T08:00:00Z',
		candidates: [
			{ drill: 'tone-pairs', items: ['b', 'a'] },
			{ drill: 'counters', items: ['z'] }
		],
		events: [ev('tone-pairs', 'b', 3, t0), ev('tone-pairs', 'a', 3, t0), ev('counters', 'z', 3, t0)]
	},
	{
		name: 'a drill that no longer applies is not a candidate; at most 20 items',
		now: '2026-12-01T08:00:00Z',
		candidates: [{ drill: 'tone-pairs', items: Array.from({ length: 22 }, (_, i) => `p${String(i + 1).padStart(2, '0')}`) }],
		events: [
			...Array.from({ length: 22 }, (_, i) => ev('tone-pairs', `p${String(i + 1).padStart(2, '0')}`, (i % 4) + 1, `2026-11-2${i % 8}T08:00:00Z`)),
			ev('counters', 'gone', 1, t0)
		]
	}
];

// ---- output ----

function scheduleFile() {
	return {
		version: 1,
		rule: 'drills/schedule',
		generator: 'scripts/contracts/gen-drills-fixtures.mjs',
		tsFsrs: version,
		note: 'Each drill item\'s schedule, replayed from its answers in workspace 7 as a card\'s reviews are (default weights, the study clock), and its retrievability at `now`. `clock` lists frozen runs {a: start instant, days}. Compare `due` exactly and the numbers to 8 decimals. Decoded by the web (FSRS is client-side).',
		weights: [...default_w],
		cases: scheduleCases.map((c) => {
			const clock = clockOf(c.clock ?? []);
			const now = ms(c.now);
			const items = [...states(c.events, clock).values()]
				.map((s) => view(s, now, clock))
				.sort((a, b) => cmp(a.drill, b.drill) || cmp(a.item, b.item));
			return { name: c.name, now: c.now, clock: c.clock ?? [], events: c.events, items };
		})
	};
}

function pickFile() {
	return {
		version: 1,
		rule: 'drills/pick',
		generator: 'scripts/contracts/gen-drills-fixtures.mjs',
		tsFsrs: version,
		note: "A drill's round (`round`: due, new, ahead) and the practise-weakest round across drills (`weakest`), over workspace 7's answers, no vacation. `items` / `candidates` are the drills' candidate items in the order each drill introduces them. Decoded by the web.",
		constants: { roundSize: ROUND_SIZE, newPerRound: NEW_PER_ROUND },
		round: pickCases.map((c) => ({
			name: c.name,
			now: c.now,
			drill: c.drill,
			items: c.items,
			events: c.events,
			expect: roundOf(c.drill, c.items, c.events, ms(c.now), clockOf([]))
		})),
		weakest: weakestCases.map((c) => ({
			name: c.name,
			now: c.now,
			candidates: c.candidates,
			events: c.events,
			expect: weakestOf(c.candidates, c.events, ms(c.now), clockOf([]))
		}))
	};
}

const files = { 'schedule.json': scheduleFile(), 'pick.json': pickFile() };
const check = process.argv.includes('--check');
let stale = false;
for (const [name, value] of Object.entries(files)) {
	const path = join(dir, name);
	const text = JSON.stringify(value, null, 1) + '\n';
	if (check) {
		if (!existsSync(path) || readFileSync(path, 'utf8') !== text) {
			console.error(`${name} is stale: run node scripts/contracts/gen-drills-fixtures.mjs`);
			stale = true;
		}
	} else writeFileSync(path, text);
}
if (stale) process.exit(1);
