#!/usr/bin/env node
// Generates docs/contracts/scheduler/vacation-schedule.json and the
// "plain" part of optimizer-steps.json from PLAIN ts-fsrs, as an oracle that
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
const { createEmptyCard, fsrs, Rating } = await import(pathToFileURL(join(tsfsrsDir, 'dist', 'index.mjs')).href);
const version = JSON.parse(readFileSync(join(tsfsrsDir, 'package.json'), 'utf8')).version;

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
		note: 'due 14:10Z precedes the run start 15:00Z'
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

const outputs = [
	['vacation-schedule.json', schedule],
	['optimizer-steps.json', optimizer]
];
let differs = false;
for (const [file, data] of outputs) {
	const text = `${JSON.stringify(data, null, 2)}\n`;
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
