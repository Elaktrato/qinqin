#!/usr/bin/env node
// Generates docs/contracts/grammar/review.json (the spaced review of grammar
// points, #181: when a point is learned, how a run becomes a grade, each
// point's schedule replayed from its runs, the review round with the daily
// new cap, the examples a review picks) from PLAIN ts-fsrs, as an oracle
// that shares no code with the project: the rules are written here again
// from docs/contracts/grammar/README.md ("Review").
//
//   node scripts/contracts/gen-grammar-review-fixtures.mjs          write the file
//   node scripts/contracts/gen-grammar-review-fixtures.mjs --check  exit 1 when it differs
//
// ts-fsrs is read from apps/web/node_modules (run `npm --prefix apps/web ci` first).

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const path = join(root, 'docs', 'contracts', 'grammar', 'review.json');
const tsfsrsDir = join(root, 'apps', 'web', 'node_modules', 'ts-fsrs');
if (!existsSync(tsfsrsDir)) {
	console.error('ts-fsrs not found: run `npm --prefix apps/web ci` first');
	process.exit(2);
}
const { createEmptyCard, fsrs, Rating, default_w } = await import(pathToFileURL(join(tsfsrsDir, 'dist', 'index.mjs')).href);
const version = JSON.parse(readFileSync(join(tsfsrsDir, 'package.json'), 'utf8')).version;

const DAY = 86_400_000;
const RATING = { 1: Rating.Again, 2: Rating.Hard, 3: Rating.Good };
const LEARNED_PERCENT = 80;
const NEW_PER_DAY = 5;
const ROUND_SIZE = 20;
const EXERCISES = 3;
const WS = 7;
const ms = (iso) => Date.parse(iso);
const iso = (t) => new Date(t).toISOString().replace('.000Z', 'Z');
const round8 = (x) => Math.round(x * 1e8) / 1e8;
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// ---- the rules, written again from the README ----

const PACK = /^[A-Za-z0-9._-]{1,128}$/;
const LESSON = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const count = (v) => Number.isInteger(v) && v >= 0 && v <= 1000;

function runOf(e) {
	if (e.workspaceId !== WS || e.type !== 'grammar') return null;
	const p = e.payload;
	if (typeof p !== 'object' || p === null || Array.isArray(p)) return null;
	if (p.mode !== 'lesson' && p.mode !== 'review') return null;
	if (typeof p.point !== 'string') return null;
	const at = p.point.indexOf(':');
	if (at < 0) return null;
	const pack = p.point.slice(0, at);
	const lesson = p.point.slice(at + 1);
	if (!PACK.test(pack) || lesson.length > 128 || !LESSON.test(lesson)) return null;
	if (!count(p.score) || !count(p.total) || p.score > p.total) return null;
	const t = ms(e.ts);
	if (!Number.isFinite(t)) return null;
	return { id: e.id, ts: e.ts, at: t, point: p.point, mode: p.mode, score: p.score, total: p.total };
}

const learned = (score, total) => total > 0 && 100 * score >= LEARNED_PERCENT * total;
const grade = (score, total) => (learned(score, total) ? 3 : 2 * score >= total ? 2 : 1);

/** The study clock of runs [{a, days}]: v(t) and its inverse. */
function clockOf(runs) {
	const rs = runs.map((r) => ({ a: ms(r.a), n: r.days })).sort((x, y) => x.a - y.a);
	return {
		v: (t) => rs.reduce((out, r) => out - Math.min(Math.max(t - r.a, 0), r.n * DAY), t),
		inverse: (x) => rs.reduce((t, r) => (t >= r.a ? t + r.n * DAY : t), x)
	};
}

/** The learner's date of an instant in one zone (no zone changes in these cases). */
function dayIn(zone, t) {
	return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t));
}

const scheduler = fsrs({ w: [...default_w] });

/** Every learned point's state, by point. */
function states(events, clock) {
	const runs = events.map(runOf).filter((r) => r !== null);
	runs.sort((x, y) => x.at - y.at || cmp(x.id, y.id));
	const out = new Map();
	for (const r of runs) {
		let s = out.get(r.point);
		if (s === undefined) {
			if (r.mode !== 'lesson' || !learned(r.score, r.total)) continue;
			s = { point: r.point, learnedAt: r.ts, reviews: 0, lastReviewed: null, firstReviewAt: null, card: createEmptyCard(new Date(clock.v(r.at))), fed: -Infinity };
			out.set(r.point, s);
		} else {
			if (r.total === 0) continue;
			s.reviews += 1;
			s.lastReviewed = r.ts;
			if (s.firstReviewAt === null) s.firstReviewAt = r.at;
		}
		const fed = Math.max(clock.v(r.at), s.fed);
		s.card = scheduler.next(s.card, new Date(fed), RATING[grade(r.score, r.total)]).card;
		s.fed = fed;
	}
	return out;
}

function view(s, clock) {
	return {
		point: s.point,
		learnedAt: s.learnedAt,
		reviews: s.reviews,
		lastReviewed: s.lastReviewed,
		due: iso(clock.inverse(s.card.due.getTime())),
		stability: round8(s.card.stability),
		difficulty: round8(s.card.difficulty),
		state: s.card.state
	};
}

function roundOf(candidates, events, now, zone) {
	const clock = clockOf([]);
	const all = states(events, clock);
	const today = dayIn(zone, now);
	let newToday = 0;
	for (const s of all.values()) if (s.firstReviewAt !== null && dayIn(zone, s.firstReviewAt) === today) newToday++;
	const due = [];
	const fresh = [];
	for (const point of new Set(candidates)) {
		const s = all.get(point);
		if (s === undefined) continue;
		const at = clock.inverse(s.card.due.getTime());
		if (at > now) continue;
		if (s.reviews > 0) due.push({ point, due: at });
		else fresh.push({ point, learned: ms(s.learnedAt) });
	}
	due.sort((a, b) => a.due - b.due || cmp(a.point, b.point));
	fresh.sort((a, b) => a.learned - b.learned || cmp(a.point, b.point));
	const offered = fresh.slice(0, Math.max(0, NEW_PER_DAY - newToday));
	const items = [...due.map((d) => ({ point: d.point, why: 'due' })), ...offered.map((f) => ({ point: f.point, why: 'new' }))].slice(0, ROUND_SIZE);
	return { items, due: due.length, new: offered.length, newToday };
}

function pickOf(examples, n) {
	const out = [];
	const size = examples.length;
	if (size === 0) return out;
	const start = (EXERCISES * n) % size;
	const lap = Math.floor((EXERCISES * n) / size);
	for (let i = 0; i < size && out.length < EXERCISES; i++) {
		const e = examples[(start + i) % size];
		const prefer = (n + lap + out.length) % 2 === 0 ? 'cloze' : 'order';
		const other = prefer === 'cloze' ? 'order' : 'cloze';
		if (e[prefer]) out.push({ example: e.id, kind: prefer });
		else if (e[other]) out.push({ example: e.id, kind: other });
	}
	return out;
}

// ---- the cases ----

let seq = 0;
function run(point, mode, score, total, ts, extra = {}) {
	seq++;
	return {
		id: `01KC000000000000000000${String(seq).padStart(4, '0')}`,
		workspaceId: WS,
		device: 'web',
		ts,
		type: 'grammar',
		payload: { point, mode, score, total },
		...extra
	};
}

const learnedCases = [
	[4, 5, true],
	[8, 10, true],
	[3, 4, false],
	[79, 100, false],
	[0, 0, false],
	[1, 1, true],
	[5, 6, true]
].map(([score, total, expect]) => ({ score, total, expect }));

const gradeCases = [
	[3, 3, 3],
	[2, 3, 2],
	[1, 3, 1],
	[0, 3, 1],
	[4, 5, 3],
	[3, 4, 2],
	[2, 4, 2],
	[1, 4, 1],
	[1, 2, 2]
].map(([score, total, expect]) => ({ score, total, expect }));

const P = 'zh-grammar:le-change';
const Q = 'zh-grammar:shi';
const R = 'zh-grammar:ba';

const stateCases = [
	{
		name: 'a lesson below 80 % is not learned: no schedule',
		events: [run(P, 'lesson', 3, 4, '2026-11-20T08:00:00Z')]
	},
	{
		name: 'the first lesson run at 80 % is learned and the first Good: due after the learning step',
		events: [run(P, 'lesson', 2, 4, '2026-11-20T08:00:00Z'), run(P, 'lesson', 4, 5, '2026-11-20T09:00:00Z')]
	},
	{
		name: 'reviews after learning: Good, Hard, Again move the due; lastReviewed is the last review',
		events: [
			run(P, 'lesson', 5, 5, '2026-11-01T08:00:00Z'),
			run(P, 'review', 3, 3, '2026-11-02T08:00:00Z'),
			run(P, 'review', 2, 3, '2026-11-06T08:00:00Z'),
			run(P, 'review', 0, 3, '2026-11-12T08:00:00Z'),
			run(P, 'review', 3, 3, '2026-11-12T08:20:00Z')
		]
	},
	{
		name: 'a lesson run after learning is a review too; a run with no exercises is skipped',
		events: [
			run(Q, 'lesson', 4, 4, '2026-11-01T08:00:00Z'),
			run(Q, 'lesson', 6, 6, '2026-11-03T08:00:00Z'),
			run(Q, 'review', 0, 0, '2026-11-04T08:00:00Z')
		]
	},
	{
		name: 'a review before the point is learned is ignored; the order is (ts, id), not the log order',
		events: (() => {
			const a = run(R, 'review', 3, 3, '2026-11-01T07:00:00Z');
			const b = run(R, 'lesson', 5, 5, '2026-11-01T08:00:00Z');
			const c = run(R, 'review', 1, 3, '2026-11-03T08:00:00Z');
			const d = run(R, 'review', 3, 3, '2026-11-03T08:00:00Z');
			return [d, c, b, a];
		})()
	},
	{
		name: 'other workspaces, other types and unknown modes count nowhere',
		events: [
			run(P, 'lesson', 4, 4, '2026-11-01T08:00:00Z', { workspaceId: 8 }),
			run(P, 'drill', 4, 4, '2026-11-01T08:00:00Z'),
			{ ...run(P, 'lesson', 4, 4, '2026-11-01T08:00:00Z'), type: 'review' },
			run(Q, 'lesson', 4, 4, '2026-11-01T08:00:00Z')
		]
	},
	{
		name: 'a frozen vacation run between reviews: its days do not count and the due moves past it',
		clock: [{ a: '2026-11-05T00:00:00Z', days: 7 }],
		events: [
			run(P, 'lesson', 5, 5, '2026-11-01T08:00:00Z'),
			run(P, 'review', 3, 3, '2026-11-01T08:15:00Z'),
			run(P, 'review', 3, 3, '2026-11-03T08:00:00Z')
		]
	}
];

// Five points learned on 2026-11-20, two more on 2026-11-21: the "new" pool.
const points = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((l) => `zh-grammar:${l}`);
const learnedBatch = points.map((p, i) => run(p, 'lesson', 4, 4, i < 5 ? `2026-11-20T08:0${i}:00Z` : `2026-11-21T08:0${i}:00Z`));

const roundCases = [
	{
		name: 'new points, earliest learned first, at most 5 a day',
		now: '2026-11-22T10:00:00Z',
		zone: 'UTC',
		candidates: points,
		events: learnedBatch
	},
	{
		name: 'points whose first review was today use up the cap; their next review is not due yet',
		now: '2026-11-22T10:00:00Z',
		zone: 'UTC',
		candidates: points,
		events: [...learnedBatch, run(points[0], 'review', 3, 3, '2026-11-22T09:00:00Z'), run(points[1], 'review', 3, 3, '2026-11-22T09:01:00Z')]
	},
	{
		name: 'a first review yesterday does not count today; due reviewed points come first, earliest due first',
		now: '2026-11-25T10:00:00Z',
		zone: 'UTC',
		candidates: points,
		events: [
			...learnedBatch,
			run(points[0], 'review', 3, 3, '2026-11-22T09:00:00Z'),
			run(points[1], 'review', 1, 3, '2026-11-24T09:00:00Z'),
			run(points[2], 'review', 3, 3, '2026-11-23T09:00:00Z')
		]
	},
	{
		name: 'the learner day follows the zone: 23:30 UTC is already tomorrow in Tokyo',
		now: '2026-11-22T23:30:00Z',
		zone: 'Asia/Tokyo',
		candidates: points,
		events: [...learnedBatch, run(points[0], 'review', 3, 3, '2026-11-22T10:00:00Z'), run(points[1], 'review', 3, 3, '2026-11-22T10:01:00Z')]
	},
	{
		name: 'only candidate points (installed lessons) are offered; not-learned points never',
		now: '2026-11-22T10:00:00Z',
		zone: 'UTC',
		candidates: ['zh-grammar:b', 'zh-grammar:z', 'zh-grammar:a', 'zh-grammar:b'],
		events: [...learnedBatch, run('zh-grammar:z', 'lesson', 1, 4, '2026-11-20T08:00:00Z')]
	},
	{
		name: 'nothing learned: an empty round',
		now: '2026-11-22T10:00:00Z',
		zone: 'UTC',
		candidates: points,
		events: []
	},
	{
		name: 'at most 20 points in a round, due ones first',
		now: '2026-12-20T10:00:00Z',
		zone: 'UTC',
		candidates: Array.from({ length: 24 }, (_, i) => `big:p${String(i).padStart(2, '0')}`),
		events: Array.from({ length: 24 }, (_, i) => [
			run(`big:p${String(i).padStart(2, '0')}`, 'lesson', 4, 4, `2026-11-01T08:${String(i).padStart(2, '0')}:00Z`),
			...(i < 22 ? [run(`big:p${String(i).padStart(2, '0')}`, 'review', 3, 3, `2026-11-02T08:${String(i).padStart(2, '0')}:00Z`)] : [])
		]).flat()
	}
];

const ex = (id, cloze, order) => ({ id, cloze, order });
const six = ['e1', 'e2', 'e3', 'e4', 'e5', 'e6'].map((id) => ex(id, true, true));
const pickCases = [
	{ name: 'the first review: examples 1 to 3, cloze, order, cloze', examples: six, reviews: 0 },
	{ name: 'the second review starts three examples on, order first', examples: six, reviews: 1 },
	{ name: 'the third review is back at the first example, each with the other kind', examples: six, reviews: 2 },
	{ name: 'two examples: two exercises', examples: [ex('e1', true, true), ex('e2', true, true)], reviews: 0 },
	{ name: 'four examples, the second review starts at the fourth and wraps', examples: six.slice(0, 4), reviews: 1 },
	{
		name: 'an example that cannot be the preferred kind gives the other; one that can be neither is skipped',
		examples: [ex('e1', false, true), ex('e2', false, false), ex('e3', true, false), ex('e4', true, true)],
		reviews: 0
	},
	{ name: 'no example: no exercise', examples: [], reviews: 3 }
];

function file() {
	return {
		version: 1,
		rule: 'grammar/review',
		generator: 'scripts/contracts/gen-grammar-review-fixtures.mjs',
		tsFsrs: version,
		note: 'The spaced review of grammar points (#181), over workspace 7\'s `grammar` runs: `learned` and `grade` (a run\'s score to an FSRS grade), `build` (the review payload), `states` (each learned point replayed from its runs as a card\'s reviews: default weights, the study clock; `clock` lists frozen runs {a, days}), `round` (the due points and the new points under the daily cap; `zone` is the learner\'s zone, `candidates` the installed points in lesson order), `pick` (the examples a review asks). Compare `due` as an instant and the numbers to 8 decimals. Decoded by the web (FSRS is client-side).',
		constants: { learnedPercent: LEARNED_PERCENT, newPerDay: NEW_PER_DAY, roundSize: ROUND_SIZE, exercisesPerReview: EXERCISES, reviewMode: 'review' },
		weights: [...default_w],
		learned: learnedCases,
		grade: gradeCases,
		build: [
			{
				name: 'a review run names the point, the mode review, the score and the total, in this member order',
				args: ['zh-grammar', 'le-change', 2, 3],
				expect: { point: 'zh-grammar:le-change', mode: 'review', score: 2, total: 3 }
			}
		],
		states: stateCases.map((c) => {
			const clock = clockOf(c.clock ?? []);
			const points = [...states(c.events, clock).values()].map((s) => view(s, clock)).sort((a, b) => cmp(a.point, b.point));
			return { name: c.name, clock: c.clock ?? [], events: c.events, expect: points };
		}),
		round: roundCases.map((c) => ({ name: c.name, now: c.now, zone: c.zone, candidates: c.candidates, events: c.events, expect: roundOf(c.candidates, c.events, ms(c.now), c.zone) })),
		pick: pickCases.map((c) => ({ name: c.name, examples: c.examples, reviews: c.reviews, expect: pickOf(c.examples, c.reviews) }))
	};
}

const text = JSON.stringify(file(), null, 1) + '\n';
if (process.argv.includes('--check')) {
	if (!existsSync(path) || readFileSync(path, 'utf8') !== text) {
		console.error('review.json is stale: run node scripts/contracts/gen-grammar-review-fixtures.mjs');
		process.exit(1);
	}
} else writeFileSync(path, text);
