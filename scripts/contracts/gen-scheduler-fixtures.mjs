#!/usr/bin/env node
// Generates docs/contracts/scheduler/vacation-schedule.json, the
// "plain" part of optimizer-steps.json, next-intervals.json (the interval
// each grade would give, #101) and fsrs.json (the FSRS pin: every
// parameter, the clamp ranges, weight validation and migration, parameter
// sets, the active set and a replay oracle) from PLAIN ts-fsrs, as an oracle that
// shares no code with the project: a history that has a vacation is replayed
// with every review after a run moved earlier by the run's whole days
// (n x 24 h) and the resulting due moved later by the same amount when it
// reaches the run. No study-clock code is used here.
//
//   node scripts/contracts/gen-scheduler-fixtures.mjs          write the files
//   node scripts/contracts/gen-scheduler-fixtures.mjs --check  exit 1 when they differ
//
// ts-fsrs is read from apps/web/node_modules (run `npm --prefix apps/web ci`
// first); its version is recorded in the fixture. The hand-written
// inside-run cases of optimizer-steps.json live in
// docs/contracts/scheduler/optimizer-steps.inside.json and are merged in.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const dir = join(root, 'docs', 'contracts', 'scheduler');
const tsfsrsDir = join(root, 'apps', 'web', 'node_modules', 'ts-fsrs');
if (!existsSync(tsfsrsDir)) {
	console.error('ts-fsrs not found: run `npm --prefix apps/web ci` first');
	process.exit(2);
}
const { createEmptyCard, fsrs, Rating, generatorParameters, CLAMP_PARAMETERS, checkParameters, migrateParameters, default_w } = await import(pathToFileURL(join(tsfsrsDir, 'dist', 'index.mjs')).href);
const version = JSON.parse(readFileSync(join(tsfsrsDir, 'package.json'), 'utf8')).version;

// ts-fsrs announces every 17/19 -> 21 migration on console.debug.
console.debug = () => {};

const DAY = 86_400_000;
const RATING = { 1: Rating.Again, 2: Rating.Hard, 3: Rating.Good, 4: Rating.Easy };
const ms = (iso) => Date.parse(iso);
const iso = (t) => new Date(t).toISOString().replace('.000Z', 'Z');

// Each run: the instant its first date starts in the learner's zone (`a`,
// written down here, not computed) and its number of dates `n`.
const CASES = [
	{
		name: 'no vacation: identical to plain ts-fsrs',
		zone: 'UTC', runs: [],
		reviews: [['2026-02-01T09:00:00Z', 3], ['2026-02-02T09:00:00Z', 3], ['2026-02-09T09:00:00Z', 2], ['2026-03-01T09:00:00Z', 4]],
		note: 'identity clock'
	},
	{
		name: 'Berlin: 7-day vacation across the DST end 2025-10-26',
		zone: 'Europe/Berlin', runs: [{ start: '2025-10-22', a: '2025-10-21T22:00:00Z', n: 7 }],
		reviews: [['2025-10-10T09:00:00Z', 3], ['2025-10-11T09:00:00Z', 3], ['2025-10-20T09:00:00Z', 3], ['2025-11-03T09:00:00Z', 3], ['2025-11-12T09:00:00Z', 3]],
		note: 'dueDayShift may be 6 or 7 local dates: the shift is 7 x 24 h and the clock changes by one hour'
	},
	{
		name: 'Tokyo: 7-day vacation, lapse after it',
		zone: 'Asia/Tokyo', runs: [{ start: '2026-01-05', a: '2026-01-04T15:00:00Z', n: 7 }],
		reviews: [['2025-12-20T00:00:00Z', 3], ['2025-12-21T00:00:00Z', 3], ['2025-12-30T00:00:00Z', 3], ['2026-01-14T00:00:00Z', 1], ['2026-01-15T00:00:00Z', 3]],
		note: 'first review after the run is a lapse'
	},
	{
		name: 'Tokyo: learning card due after the run starts is pushed past it',
		zone: 'Asia/Tokyo', runs: [{ start: '2026-01-05', a: '2026-01-04T15:00:00Z', n: 7 }],
		reviews: [['2026-01-04T14:55:00Z', 3]],
		note: 'the 10 minute learning step ends after the run start, so due moves by the whole run'
	},
	{
		name: 'Tokyo: learning card due before the run starts is not moved',
		zone: 'Asia/Tokyo', runs: [{ start: '2026-01-05', a: '2026-01-04T15:00:00Z', n: 7 }],
		reviews: [['2026-01-04T14:00:00Z', 1]],
		note: 'due 14:01Z precedes the run start 15:00Z'
	},
	{
		name: 'two runs, reviews between and after',
		zone: 'Asia/Tokyo', runs: [{ start: '2026-01-05', a: '2026-01-04T15:00:00Z', n: 3 }, { start: '2026-01-20', a: '2026-01-19T15:00:00Z', n: 2 }],
		reviews: [['2025-12-28T03:00:00Z', 3], ['2026-01-02T03:00:00Z', 3], ['2026-01-09T03:00:00Z', 3], ['2026-01-23T03:00:00Z', 2], ['2026-02-10T03:00:00Z', 3]],
		note: 'later reviews shift by the sum of the earlier runs'
	},
	{
		name: 'gap shortened below a day by the vacation',
		zone: 'Asia/Tokyo', runs: [{ start: '2026-01-05', a: '2026-01-04T15:00:00Z', n: 7 }],
		reviews: [['2026-01-04T10:00:00Z', 3], ['2026-01-11T20:00:00Z', 3]],
		note: 'seven real days apart, the same UTC day on the study clock: the step is 0 days and is not labelled'
	},
	{
		name: 'review on the first day back',
		zone: 'Europe/Berlin', runs: [{ start: '2025-10-22', a: '2025-10-21T22:00:00Z', n: 7 }],
		reviews: [['2025-10-15T09:00:00Z', 3], ['2025-10-20T09:00:00Z', 3], ['2025-10-28T22:00:00Z', 3]],
		note: 'a review exactly at the end of the frozen interval counts the shifted instant'
	}
];

function localDate(zone, t) {
	return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t));
}
const dayNumber = (d) => Math.round(Date.parse(`${d}T00:00:00Z`) / DAY);

// ts-fsrs's UTC calendar elapsed days (dateDiffInDays).
function utcDiff(a, b) {
	const u = (t) => Date.UTC(new Date(t).getUTCFullYear(), new Date(t).getUTCMonth(), new Date(t).getUTCDate());
	return Math.floor((u(b) - u(a)) / DAY);
}

function replay(c) {
	const f = fsrs();
	const runs = c.runs.map((r) => ({ a: ms(r.a), n: r.n }));
	const shifted = c.reviews.map(([ts]) => {
		const t = ms(ts);
		let shift = 0;
		for (const r of runs) {
			if (t >= r.a && t < r.a + r.n * DAY) {
				// Reviews inside a run are hand-written cases, not oracle cases.
				if (t !== r.a + r.n * DAY) throw new Error(`${c.name}: review inside a run`);
			}
			if (t >= r.a + r.n * DAY) shift += r.n * DAY;
		}
		return t - shift;
	});
	let card = createEmptyCard(new Date(shifted[0]));
	const steps = [];
	c.reviews.forEach(([, grade], i) => {
		card = f.next(card, new Date(shifted[i]), RATING[grade]).card;
		steps.push({ t: i === 0 ? 0 : utcDiff(shifted[i - 1], shifted[i]), g: grade });
	});
	const dueV = card.due.getTime();
	let due = dueV;
	for (const r of runs) if (due >= r.a) due += r.n * DAY;
	const dueDayShift = dayNumber(localDate(c.zone, due)) - dayNumber(localDate(c.zone, dueV));
	return {
		steps,
		expected: { due: iso(due), stability: card.stability, difficulty: card.difficulty, state: card.state },
		dueDayShift
	};
}

const schedule = {
	version: 1,
	rule: 'scheduler/vacation-schedule',
	generator: 'scripts/contracts/gen-scheduler-fixtures.mjs',
	tsFsrs: version,
	parameters: 'ts-fsrs default parameters, short-term on, fuzz off',
	cases: []
};
const plainSteps = [];
for (const c of CASES) {
	const r = replay(c);
	schedule.cases.push({
		name: c.name,
		zone: c.zone,
		runs: c.runs.map(({ start, a, n }) => ({ start, a, n })),
		reviews: c.reviews.map(([ts, grade]) => ({ ts, grade })),
		expected: r.expected,
		dueDayShift: r.dueDayShift,
		note: c.note
	});
	plainSteps.push({
		name: c.name,
		zone: c.zone,
		runs: c.runs.map(({ start, a, n }) => ({ start, a, n })),
		reviews: c.reviews.map(([ts, grade]) => ({ ts, grade })),
		steps: r.steps,
		labelled: r.steps.filter((s, i) => i > 0 && s.t >= 1).length
	});
}

const inside = JSON.parse(readFileSync(join(dir, 'optimizer-steps.inside.json'), 'utf8'));
const optimizer = {
	version: 1,
	rule: 'scheduler/optimizer-steps',
	generator: 'scripts/contracts/gen-scheduler-fixtures.mjs',
	tsFsrs: version,
	cases: [...plainSteps, ...inside.cases]
};

// --- fsrs.json: the FSRS pin -------------------------------------------------
// Everything below calls ts-fsrs directly; nothing of apps/web/src is
// imported. The parameter-set and active-set expectations are rules of the
// project (not of ts-fsrs) and are written down here, case by case.

const INFINITY = '__infinity__';
const FSRS4_W = [0.4872, 1.4003, 3.7145, 13.8206, 5.1618, 1.2298, 0.8975, 0.031, 1.6474, 0.1367, 1.0461, 2.1072, 0.0793, 0.3246, 1.587, 0.2272, 2.8755];
const FSRS5_W = [0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575, 0.1192, 1.01925, 1.9395, 0.11, 0.29605, 2.2698, 0.2315, 2.9898, 0.51655, 0.6621];
const CUSTOM_W = [0.3, 1.1, 2.9, 9.5, 6.9, 0.7, 2.5, 0.01, 1.6, 0.2, 0.9, 1.6, 0.08, 0.3, 1.5, 0.5, 2.2, 0.6, 0.15, 0.1, 0.25];
const ranges = CLAMP_PARAMETERS(2, true);

// The weight check as ts-fsrs defines it: checkParameters (finite, 17/19/21),
// then every raw value inside CLAMP_PARAMETERS(2, true) at its position (a
// value migrateParameters would clip is rejected, not clipped).
function weightVerdict(raw) {
	if (!Array.isArray(raw) || !raw.every((x) => typeof x === 'number')) return { ok: false, reason: 'notNumbers' };
	try {
		checkParameters(raw);
	} catch {
		const bad = raw.findIndex((x) => !Number.isFinite(x));
		if (bad >= 0) return { ok: false, reason: 'nonFinite', position: bad + 1 };
		return { ok: false, reason: 'length' };
	}
	for (let i = 0; i < raw.length; i++) {
		const [min, max] = ranges[i];
		if (raw[i] < min || raw[i] > max) return { ok: false, reason: 'range', position: i + 1 };
	}
	return { ok: true, migrated: migrateParameters([...raw]) };
}

const withAt = (w, i, v) => w.map((x, j) => (j === i ? v : x));
const WEIGHT_CASES = [
	{ name: 'the 21 default weights', w: default_w, note: 'FSRS-6 defaults are valid and migrate to themselves' },
	{ name: 'a custom 21-weight set', w: CUSTOM_W, note: 'inside every clamp range: kept as given' },
	{ name: '19 weights (FSRS-5) migrate to 21', w: FSRS5_W, note: 'w19 = 0 and w20 = 0.5 (the FSRS-5 decay) are appended' },
	{ name: '17 weights (FSRS-4.5) migrate to 21', w: FSRS4_W, note: 'w4..w6 are converted, w17..w20 = 0, 0, 0, 0.5 appended' },
	{ name: 'a value below its range', w: withAt(default_w, 0, 0.0005), note: 'w1 below 0.001 is rejected with its 1-based position, never clipped' },
	{ name: 'a value above its range', w: withAt(default_w, 4, 10.5), note: 'w5 above 10 is rejected' },
	{ name: 'the range ends are inside', w: withAt(withAt(default_w, 4, 10), 0, 0.001), note: 'min and max themselves are valid' },
	{ name: 'a non-finite value', w: withAt(default_w, 2, Infinity), note: 'Infinity (1e999 in JSON) is not finite; reported with its position' },
	{ name: '18 numbers', w: default_w.slice(0, 18), note: 'only 17, 19 or 21 numbers are weights' },
	{ name: '22 numbers', w: [...default_w, 0.1], note: 'only 17, 19 or 21 numbers are weights' },
	{ name: 'no numbers', w: [], note: 'an empty list is the wrong length' },
	{ name: 'a string among the numbers', w: withAt(default_w, 0, '0.2'), note: 'every member must be a JSON number' },
	{ name: 'not a list', w: { w: default_w }, note: 'an object is not a weight list' }
].map((c) => ({ ...c, w: Array.isArray(c.w) ? [...c.w] : c.w, expect: weightVerdict(c.w) }));

// fsrs:active {setId}: the sets newest first (createdAt descending, then id
// descending); the pointer picks a set by id; missing, null, non-string or
// dangling = the default weights.
const setA = { id: 'a', w: CUSTOM_W, createdAt: '2026-10-01T00:00:00Z', source: 'optimized' };
const setB = { id: 'b', w: [...default_w], createdAt: '2026-11-01T00:00:00Z', source: 'imported' };
const setC = { id: 'c', w: CUSTOM_W, createdAt: '2026-11-01T00:00:00Z', source: 'optimized' };
const RESOLVE_CASES = [
	{ name: 'pointer to a set', sets: [setA, setB, setC], active: { setId: 'a' }, expect: { order: ['c', 'b', 'a'], active: 'a', w: 'a', pointer: 'a' }, note: 'newest first; equal createdAt: the larger id first' },
	{ name: 'no pointer row', sets: [setA], active: null, expect: { order: ['a'], active: null, w: 'default', pointer: null }, note: 'no pointer: the default weights' },
	{ name: 'a dangling pointer', sets: [setA], active: { setId: 'gone' }, expect: { order: ['a'], active: null, w: 'default', pointer: 'gone' }, note: 'a pointer to a set that is not there means the defaults; the pointer is still reported' },
	{ name: 'setId null', sets: [setA], active: { setId: null }, expect: { order: ['a'], active: null, w: 'default', pointer: null }, note: 'a null setId is no pointer' },
	{ name: 'setId not a string', sets: [setA], active: { setId: 1 }, expect: { order: ['a'], active: null, w: 'default', pointer: null }, note: 'only a string names a set' }
];

const DEFAULT = 'default';
const T = (iso) => iso;
// Replay oracle: reviews in (instant, id) order fed to plain ts-fsrs with
// the case's weights (identity study clock), the card after every review.
const REPLAY_CASES = [
	{ name: 'new card: Again, then Good through both learning steps, then a day', w: DEFAULT, reviews: [[T('2026-01-05T09:00:00Z'), 1], [T('2026-01-05T09:01:00Z'), 3], [T('2026-01-05T09:11:00Z'), 3], [T('2026-01-06T09:11:00Z'), 3]], note: 'learning steps 1m and 10m, then the review state' },
	{ name: 'new card Good twice in learning', w: DEFAULT, reviews: [[T('2026-01-05T09:00:00Z'), 3], [T('2026-01-05T09:10:00Z'), 3]], note: 'Good on a new card goes to the 10m step; Good at the step graduates' },
	{ name: 'Again repeated in learning', w: DEFAULT, reviews: [[T('2026-01-05T09:00:00Z'), 1], [T('2026-01-05T09:01:00Z'), 1], [T('2026-01-05T09:02:00Z'), 1], [T('2026-01-05T09:03:00Z'), 3], [T('2026-01-05T09:13:00Z'), 3]], note: 'Again stays on the first step' },
	{ name: 'Hard from new', w: DEFAULT, reviews: [[T('2026-01-05T09:00:00Z'), 2], [T('2026-01-05T09:06:00Z'), 2], [T('2026-01-05T09:20:00Z'), 3]], note: 'Hard on the first step waits between the steps' },
	{ name: 'Easy from new', w: DEFAULT, reviews: [[T('2026-01-05T09:00:00Z'), 4], [T('2026-01-20T09:00:00Z'), 4]], note: 'Easy skips the learning steps' },
	{ name: 'Good on the due dates', w: DEFAULT, reviews: [[T('2026-01-05T09:00:00Z'), 3], [T('2026-01-05T09:10:00Z'), 3], [T('2026-01-08T09:00:00Z'), 3], [T('2026-01-19T09:00:00Z'), 3], [T('2026-02-20T09:00:00Z'), 3]], note: 'a well-known card' },
	{ name: 'a lapse after months, relearning, back to review', w: DEFAULT, reviews: [[T('2026-01-05T09:00:00Z'), 3], [T('2026-01-05T09:10:00Z'), 3], [T('2026-01-08T09:00:00Z'), 3], [T('2026-05-08T09:00:00Z'), 1], [T('2026-05-08T09:10:00Z'), 3], [T('2026-05-09T09:00:00Z'), 3]], note: 'Again in review goes to relearning (10m), lapses + 1' },
	{ name: 'Again in relearning', w: DEFAULT, reviews: [[T('2026-01-05T09:00:00Z'), 4], [T('2026-01-25T09:00:00Z'), 1], [T('2026-01-25T09:10:00Z'), 1], [T('2026-01-25T09:20:00Z'), 3]], note: 'Again on the relearning step stays there' },
	{ name: 'several lapses', w: DEFAULT, reviews: [[T('2026-01-05T09:00:00Z'), 4], [T('2026-01-20T09:00:00Z'), 1], [T('2026-01-20T09:10:00Z'), 3], [T('2026-01-25T09:00:00Z'), 1], [T('2026-01-25T09:10:00Z'), 3], [T('2026-02-05T09:00:00Z'), 1], [T('2026-02-05T09:10:00Z'), 3]], note: 'each Again in review counts a lapse' },
	{ name: 'sub-day reviews of a review card', w: DEFAULT, reviews: [[T('2026-01-05T09:00:00Z'), 4], [T('2026-01-05T15:00:00Z'), 3], [T('2026-01-05T21:00:00Z'), 3], [T('2026-01-06T03:00:00Z'), 2]], note: 'same-day reviews of a review card use the short-term formula' },
	{ name: 'early review before the due date', w: DEFAULT, reviews: [[T('2026-01-05T09:00:00Z'), 4], [T('2026-01-08T09:00:00Z'), 3]], note: 'a review before due counts its real elapsed days' },
	{ name: 'a very late review', w: DEFAULT, reviews: [[T('2026-01-05T09:00:00Z'), 3], [T('2026-01-05T09:10:00Z'), 3], [T('2027-01-05T09:00:00Z'), 3]], note: 'a year overdue and still remembered' },
	{ name: 'Easy every time up to the maximum interval', w: DEFAULT, reviews: (() => { const out = []; let t = Date.parse('2026-01-05T09:00:00Z'); const f = fsrs(); let card = createEmptyCard(new Date(t)); for (let i = 0; i < 9; i++) { out.push([iso(t), 4]); card = f.next(card, new Date(t), Rating.Easy).card; t = card.due.getTime(); } return out; })(), note: 'reviewed on each due date; intervals never exceed maximum_interval 36500' },
	{ name: 'Hard every time', w: DEFAULT, reviews: [[T('2026-01-05T09:00:00Z'), 3], [T('2026-01-05T09:10:00Z'), 3], [T('2026-01-08T09:00:00Z'), 2], [T('2026-01-12T09:00:00Z'), 2], [T('2026-01-18T09:00:00Z'), 2]], note: 'Hard grows the interval slowly' },
	{ name: 'every grade in turn', w: DEFAULT, reviews: [[T('2026-01-05T09:00:00Z'), 2], [T('2026-01-05T09:08:00Z'), 3], [T('2026-01-06T09:00:00Z'), 4], [T('2026-01-16T09:00:00Z'), 1], [T('2026-01-16T09:10:00Z'), 2], [T('2026-01-16T09:30:00Z'), 3]], note: 'all four ratings in learning, review and relearning' },
	{ name: 'two reviews in the same second: id order, Again first', w: DEFAULT, reviews: [[T('2026-01-05T09:00:00Z'), 3, '01KA0000000000000000000002'], [T('2026-01-05T09:00:00Z'), 1, '01KA0000000000000000000001']], note: 'the same instant replays by id: 01 (Again) before 02 (Good), whatever the order given' },
	{ name: 'two reviews in the same second: id order, Good first', w: DEFAULT, reviews: [[T('2026-01-05T09:00:00Z'), 1, '01KA0000000000000000000002'], [T('2026-01-05T09:00:00Z'), 3, '01KA0000000000000000000001']], note: 'swapping the ids swaps the result' },
	{ name: 'one instant in two notations', w: DEFAULT, reviews: [[T('2026-01-05T10:00:00+01:00'), 4, '01KA0000000000000000000002'], [T('2026-01-05T09:00:00Z'), 1, '01KA0000000000000000000001']], note: 'ordered by the instant, so the id decides' },
	{ name: 'out-of-order input is sorted by instant', w: DEFAULT, reviews: [[T('2026-01-08T09:00:00Z'), 3], [T('2026-01-05T09:00:00Z'), 3], [T('2026-01-05T09:10:00Z'), 3]], note: 'replay order is the instant, not the order given' },
	{ name: 'a custom 21-weight set', w: CUSTOM_W, reviews: [[T('2026-01-05T09:00:00Z'), 3], [T('2026-01-05T09:10:00Z'), 3], [T('2026-01-08T09:00:00Z'), 3], [T('2026-01-20T09:00:00Z'), 1], [T('2026-01-20T09:10:00Z'), 3]], note: 'the active set\'s weights replace the defaults; every other option unchanged' },
	{ name: 'a migrated 17-weight set', w: migrateParameters([...FSRS4_W]), from: FSRS4_W, reviews: [[T('2026-01-05T09:00:00Z'), 3], [T('2026-01-05T09:10:00Z'), 3], [T('2026-01-09T09:00:00Z'), 3], [T('2026-01-25T09:00:00Z'), 4]], note: 'stored sets hold the 21 migrated weights (from: the 17 given)' },
	{ name: 'a migrated 19-weight set', w: migrateParameters([...FSRS5_W]), from: FSRS5_W, reviews: [[T('2026-01-05T09:00:00Z'), 1], [T('2026-01-05T09:01:00Z'), 3], [T('2026-01-05T09:11:00Z'), 3], [T('2026-01-07T09:00:00Z'), 3]], note: 'w19 = 0, w20 = 0.5 after migration' }
];

const pointOf = (card) => ({
	due: iso(card.due.getTime()),
	stability: card.stability,
	difficulty: card.difficulty,
	state: card.state,
	reps: card.reps,
	lapses: card.lapses,
	scheduled_days: card.scheduled_days,
	learning_steps: card.learning_steps
});

function replayPlain(c) {
	const w = c.w === DEFAULT ? [...default_w] : c.w;
	const f = fsrs({ w });
	const reviews = c.reviews.map(([ts, grade, id], i) => ({ id: id ?? `01KA00000000000000000000${String(i + 1).padStart(2, '0')}`, ts, grade }));
	const order = [...reviews].sort((a, b) => ms(a.ts) - ms(b.ts) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
	let card = createEmptyCard(new Date(ms(order[0].ts)));
	const points = order.map((r) => {
		card = f.next(card, new Date(ms(r.ts)), RATING[r.grade]).card;
		return pointOf(card);
	});
	return { reviews, order: order.map((r) => r.id), points };
}

const fsrsPin = {
	version: 1,
	rule: 'scheduler/fsrs',
	generator: 'scripts/contracts/gen-scheduler-fixtures.mjs',
	tsFsrs: version,
	parameters: generatorParameters(),
	clampRanges: ranges,
	weights: WEIGHT_CASES.map(({ name, note, w, expect }) => ({ name, note, w, expect })),
	resolve: RESOLVE_CASES.map(({ name, note, sets, active, expect }) => ({ name, note, sets, active, expect })),
	replay: REPLAY_CASES.map((c) => {
		const r = replayPlain(c);
		const out = { name: c.name, note: c.note, w: c.w };
		if (c.from) out.from = c.from;
		return { ...out, reviews: r.reviews, order: r.order, points: r.points };
	})
};

// --- next-intervals.json: the interval each grade would give (#101) ----------
// The card is replayed exactly as above (plainly shifted dates for a vacation),
// `now` is fed as max(shifted now, the last fed instant), plain ts-fsrs
// `repeat(card, fedNow)` gives the four outcomes and each due is moved back
// past the runs it reaches. No history: an empty card created at fedNow.
const NEXT_CASES = [
	{ name: 'a new card', w: DEFAULT, runs: [], reviews: [], now: '2026-01-05T09:00:00Z', note: 'no card yet (a virtual item): an empty card is previewed' },
	{ name: 'after one Again (learning step 1)', w: DEFAULT, runs: [], reviews: [['2026-01-05T09:00:00Z', 1]], now: '2026-01-05T09:01:00Z', note: 'shown again at its 1 minute step' },
	{ name: 'after Good (learning step 2)', w: DEFAULT, runs: [], reviews: [['2026-01-05T09:00:00Z', 3]], now: '2026-01-05T09:10:00Z', note: 'at the 10 minute step' },
	{ name: 'a review card on its due date', w: DEFAULT, runs: [], reviews: [['2026-01-05T09:00:00Z', 3], ['2026-01-05T09:10:00Z', 3], ['2026-01-08T09:10:00Z', 3]], now: 'due', note: 'reviewed when due (`now` is the due instant of the history)' },
	{ name: 'a review card reviewed early (same day)', w: DEFAULT, runs: [], reviews: [['2026-01-05T09:00:00Z', 4]], now: '2026-01-05T15:00:00Z', note: 'the short-term formula of a same-day review' },
	{ name: 'a relearning card', w: DEFAULT, runs: [], reviews: [['2026-01-05T09:00:00Z', 4], ['2026-01-25T09:00:00Z', 1]], now: '2026-01-25T09:10:00Z', note: 'after a lapse, at the 10 minute relearning step' },
	{ name: 'a card at the maximum interval', w: DEFAULT, runs: [], reviews: (() => { const out = []; let t = Date.parse('2026-01-05T09:00:00Z'); const f = fsrs(); let card = createEmptyCard(new Date(t)); for (let i = 0; i < 9; i++) { out.push([iso(t), 4]); card = f.next(card, new Date(t), Rating.Easy).card; t = card.due.getTime(); } return out; })(), now: 'due', note: 'Easy on every due date; no interval exceeds maximum_interval' },
	{ name: 'a vacation run between the last review and now', w: DEFAULT, runs: [{ start: '2026-01-05', a: '2026-01-04T15:00:00Z', n: 7 }], zone: 'Asia/Tokyo', reviews: [['2025-12-28T03:00:00Z', 3], ['2025-12-28T03:10:00Z', 3], ['2026-01-02T03:00:00Z', 3]], now: '2026-01-14T03:00:00Z', note: 'now is moved earlier by the run (7 x 24 h) before it is fed; every previewed due is past the run start, so it moves later by the same amount' },
	{ name: 'now inside a vacation run', w: DEFAULT, runs: [{ start: '2026-01-05', a: '2026-01-04T15:00:00Z', n: 7 }], zone: 'Asia/Tokyo', reviews: [['2025-12-28T03:00:00Z', 3], ['2025-12-28T03:10:00Z', 3]], now: '2026-01-06T03:00:00Z', note: 'v(now) subtracts the part of the run already elapsed (27 h), not the whole run' },
	{ name: 'a custom 21-weight set', w: CUSTOM_W, runs: [], reviews: [['2026-01-05T09:00:00Z', 3], ['2026-01-05T09:10:00Z', 3]], now: '2026-01-09T09:00:00Z', note: 'the active set\'s weights' },
	{ name: 'a new card with a custom 21-weight set', w: CUSTOM_W, runs: [], reviews: [], now: '2026-01-05T09:00:00Z', note: 'the weights change the Easy interval of a new card' }
];

function shiftBy(runs, t) {
	// The study clock's v(): subtract the part of a run already elapsed at t,
	// not only runs that have fully ended (studyClock.ts).
	let out = t;
	for (const r of runs) out -= Math.min(Math.max(t - r.a, 0), r.n * DAY);
	return out;
}

function nextIntervals(c) {
	const w = c.w === DEFAULT ? [...default_w] : c.w;
	const f = fsrs({ w });
	const runs = c.runs.map((r) => ({ a: ms(r.a), n: r.n }));
	let card = null;
	let lastFed = -Infinity;
	for (const [ts, grade] of c.reviews) {
		const fed = Math.max(shiftBy(runs, ms(ts)), lastFed);
		if (card === null) card = createEmptyCard(new Date(fed));
		card = f.next(card, new Date(fed), RATING[grade]).card;
		lastFed = fed;
	}
	let now = c.now;
	if (now === 'due') {
		let due = card.due.getTime();
		for (const r of runs) if (due >= r.a) due += r.n * DAY;
		now = iso(due);
	}
	const fedNow = Math.max(shiftBy(runs, ms(now)), lastFed);
	const previewed = card ?? createEmptyCard(new Date(fedNow));
	const outcomes = f.repeat(previewed, new Date(fedNow));
	const expected = [1, 2, 3, 4].map((grade) => {
		let due = outcomes[RATING[grade]].card.due.getTime();
		for (const r of runs) if (due >= r.a) due += r.n * DAY;
		return { grade, due: iso(due), ms: due - ms(now) };
	});
	return { now, expected };
}

const nextPin = {
	version: 1,
	rule: 'scheduler/next-intervals',
	generator: 'scripts/contracts/gen-scheduler-fixtures.mjs',
	tsFsrs: version,
	parameters: 'ts-fsrs parameters with the case\'s weights ("default" = default_w), short-term on, fuzz off',
	cases: NEXT_CASES.map((c) => {
		const r = nextIntervals(c);
		const out = { name: c.name, note: c.note, w: c.w };
		if (c.zone) out.zone = c.zone;
		return { ...out, runs: c.runs.map(({ start, a, n }) => ({ start, a, n })), reviews: c.reviews.map(([ts, grade]) => ({ ts, grade })), now: r.now, expected: r.expected };
	})
};

const outputs = [
	['vacation-schedule.json', schedule],
	['optimizer-steps.json', optimizer],
	['fsrs.json', fsrsPin],
	['next-intervals.json', nextPin]
];
let differs = false;
for (const [file, data] of outputs) {
	// JSON has no Infinity: a weight list holding one is written as 1e999 (it parses back to Infinity).
	const text = `${JSON.stringify(data, (k, v) => (v === Infinity ? INFINITY : v), 2).replaceAll(`"${INFINITY}"`, '1e999')}\n`;
	const path = join(dir, file);
	if (process.argv.includes('--check')) {
		if (!existsSync(path) || readFileSync(path, 'utf8') !== text) {
			console.error(`${file} is out of date: run without --check`);
			differs = true;
		}
	} else {
		writeFileSync(path, text);
		console.log(`wrote ${file}`);
	}
}
process.exit(differs ? 1 : 0);
