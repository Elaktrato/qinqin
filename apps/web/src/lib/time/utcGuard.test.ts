import { describe, expect, it } from 'vitest';

// Every "day" in the app is the learner's day (lib/time/studyDay.ts). This
// scan fails when UTC day arithmetic creeps back into the source outside
// the few places where a UTC date is the right thing; each allow-list entry
// says why. Tests and testing helpers are not scanned.
const sources = import.meta.glob('/src/**/*.{ts,svelte}', {
	query: '?raw',
	import: 'default',
	eager: true
}) as Record<string, string>;

const PATTERNS: [string, RegExp][] = [
	['toISOString().slice(0, 10)', /toISOString\(\)\.slice\(0, ?10\)/],
	['/ 86_400_000)', /\/ ?86_?400_?000\)/],
	['24 * 60 * 60 * 1000)', /24 \* 60 \* 60 \* 1000\)/],
	['getUTCDate(', /getUTCDate\(/],
	['getUTCFullYear(', /getUTCFullYear\(/],
	['Date.UTC(', /Date\.UTC\(/],
	["split('T')", /split\(['"]T['"]\)/],
	['/ DAY', /\/ (?:MS_PER_)?DAY(?:_MS)?\b/]
];

// file -> pattern -> reason
const ALLOWED: Record<string, Record<string, string>> = {
	'/src/lib/time/studyDay.ts': {
		'getUTCDate(': 'the rule itself: civil date arithmetic on UTC-anchored dates',
		'getUTCFullYear(': 'the rule itself: civil date arithmetic on UTC-anchored dates',
		'Date.UTC(': 'the rule itself: civil date arithmetic and wall-clock offsets',
		'/ DAY': 'daysBetweenDates divides a difference of UTC-anchored civil dates (always whole days)'
	},
	'/src/lib/study/fsrs/preview.ts': {
		'/ DAY': 'FSRS elapsed-time arithmetic stays as ts-fsrs computes it (a non-goal of the study day)'
	},
	'/src/lib/study/fsrs/dataset.ts': {
		'/ 86_400_000)': 'real UTC day numbers for the optimizer holdout split, not a learner day'
	},
	'/src/lib/settings/PackManager.svelte': {
		'toISOString().slice(0, 10)': "a pack's install date label, a calendar date of an instant"
	},
	'/src/lib/account/tokensView.ts': {
		'/ DAY': 'expiryText: how long an access token still lives (a duration in 24 h units), not a day bucket'
	},
	'/src/lib/events.ts': {
		'24 * 60 * 60 * 1000)': 'sinceDaysAgo: an instant N x 24 h back for a fetch window, not a day bucket'
	}
};

const isTestFile = (path: string) => /\.test\.ts$/.test(path) || path.includes('/lib/testing/');

describe('no UTC day arithmetic outside the allow-list', () => {
	const hits: string[] = [];
	for (const [path, text] of Object.entries(sources)) {
		if (isTestFile(path)) continue;
		for (const [name, pattern] of PATTERNS) {
			if (pattern.test(text) && !ALLOWED[path]?.[name]) hits.push(`${path}: ${name}`);
		}
	}

	it('recognises the patterns it guards against', () => {
		const samples = [
			'd.toISOString().slice(0, 10)',
			'Math.floor(at / 86_400_000)',
			'Date.now() - n * 24 * 60 * 60 * 1000)',
			'd.getUTCDate()',
			'd.getUTCFullYear()',
			'Date.UTC(y, m, d)',
			"iso.split('T')[0]",
			'Math.floor(at / DAY_MS)'
		];
		samples.forEach((sample, i) => expect(PATTERNS[i][1].test(sample)).toBe(true));
	});

	it('finds every source file', () => {
		expect(Object.keys(sources).length).toBeGreaterThan(300);
		expect(Object.keys(sources)).toContain('/src/lib/time/studyDay.ts');
	});

	it('has no new UTC day pattern', () => {
		expect(hits).toEqual([]);
	});

	it('keeps the allow-list honest: every entry still matches', () => {
		const stale: string[] = [];
		for (const [path, entries] of Object.entries(ALLOWED)) {
			for (const name of Object.keys(entries)) {
				const pattern = PATTERNS.find(([n]) => n === name)![1];
				if (!pattern.test(sources[path] ?? '')) stale.push(`${path}: ${name}`);
			}
		}
		expect(stale).toEqual([]);
	});
});
