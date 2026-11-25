import { afterEach, describe, expect, it, vi } from 'vitest';
import settingsFixture from '../../../../../docs/contracts/settings/workspace-settings.json';
import { buzzOnGrade, GRADE_HAPTICS_KEY, hapticsAvailable, readGradeHaptics } from './haptics';

const win = window as unknown as { Capacitor?: unknown };
const nav = navigator as unknown as { vibrate?: unknown };

afterEach(() => {
	delete win.Capacitor;
	delete nav.vibrate;
	vi.restoreAllMocks();
});

describe('readGradeHaptics', () => {
	it('is on by default and for non-booleans', () => {
		expect(readGradeHaptics({})).toBe(true);
		expect(readGradeHaptics(null)).toBe(true);
		expect(readGradeHaptics({ [GRADE_HAPTICS_KEY]: 'no' })).toBe(true);
		expect(readGradeHaptics({ [GRADE_HAPTICS_KEY]: false })).toBe(false);
	});

	it('matches docs/contracts/settings/workspace-settings.json', () => {
		const f = settingsFixture as unknown as {
			keys: { key: string; default: unknown }[];
			parse: { name: string; settings: Record<string, unknown> | null; expect: { gradeHaptics: boolean } }[];
		};
		expect(f.keys.find((k) => k.key === GRADE_HAPTICS_KEY)?.default).toBe(true);
		for (const c of f.parse) expect(readGradeHaptics(c.settings), c.name).toBe(c.expect.gradeHaptics);
	});
});

describe('in a normal browser', () => {
	it('desktop (no vibrate) has no haptics and the buzz does nothing', () => {
		expect(hapticsAvailable()).toBe(false);
		expect(() => buzzOnGrade({}, 3)).not.toThrow();
	});

	it('a phone browser buzzes through navigator.vibrate, unless the switch is off', () => {
		const vibrate = vi.fn(() => true);
		nav.vibrate = vibrate;
		vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('coarse') }));
		expect(hapticsAvailable()).toBe(true);
		buzzOnGrade({}, 3);
		expect(vibrate).toHaveBeenCalledOnce();
		buzzOnGrade({ gradeHaptics: false }, 3);
		expect(vibrate).toHaveBeenCalledOnce();
		vi.unstubAllGlobals();
	});
});

describe('in the shell', () => {
	it('uses the plugin; a miss (grade 1) is a longer buzz', () => {
		const vibrate = vi.fn(async () => ({ vibrated: true }));
		win.Capacitor = { isNativePlatform: () => true, Plugins: { QinqinShell: { vibrate } } };
		expect(hapticsAvailable()).toBe(true);
		buzzOnGrade({}, 3);
		buzzOnGrade({}, 1);
		expect(vibrate.mock.calls.map((c) => (c as unknown as [{ ms: number }])[0].ms)).toEqual([20, 45]);
	});
});
