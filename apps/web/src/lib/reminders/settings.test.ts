import { describe, expect, it, vi } from 'vitest';
import fixture from '../../../../../docs/contracts/reminders/settings.json';
import {
	REMINDERS_KEY,
	defaultReminderSettings,
	inQuietHours,
	parseReminderSettings,
	saveReminderSettings,
	withReminderSettings
} from './settings';

// docs/contracts/reminders/settings.json: the parse cases and the quiet-hours cases.
describe('docs/contracts/reminders/settings.json parse', () => {
	for (const c of fixture.cases) {
		it(c.name, () => expect(parseReminderSettings(c.value)).toEqual(c.expect));
	}
});

describe('docs/contracts/reminders/settings.json quietHours', () => {
	for (const c of fixture.quietHours) {
		it(`${JSON.stringify(c.quiet)} at ${c.at} is ${c.inside ? 'inside' : 'outside'}`, () =>
			expect(inQuietHours(c.quiet, c.at)).toBe(c.inside));
	}
	it('a malformed time is never quiet', () => expect(inQuietHours({ start: '22:00', end: '08:00' }, 'x')).toBe(false));
});

describe('withReminderSettings', () => {
	it('keeps unknown keys and version 1, writes only the changed members', () => {
		const next = withReminderSettings({ version: 1, extra: { x: 1 }, enabled: false }, { enabled: true });
		expect(next).toEqual({ version: 1, extra: { x: 1 }, enabled: true });
	});
	it('starts fresh at version 1 for no row or a bad version', () => {
		expect(withReminderSettings(null, { enabled: true })).toEqual({ version: 1, enabled: true });
		expect(withReminderSettings({ version: 0, a: 1 }, {})).toEqual({ version: 1, a: 1 });
	});
	it('merges kinds and channels into what is stored', () => {
		const next = withReminderSettings({ version: 1, kinds: { due: false, other: 1 }, channels: { email: true } }, {
			kinds: { goal: false },
			channels: { push: true }
		});
		expect(next.kinds).toEqual({ due: false, other: 1, goal: false });
		expect(next.channels).toEqual({ email: true, push: true });
	});
	it('writes times cleaned and quiet as given (null is none)', () => {
		const next = withReminderSettings(null, { times: ['19:00', '07:00', 'x'], quiet: null });
		expect(next.times).toEqual(['07:00', '19:00']);
		expect(next.quiet).toBeNull();
	});
	it('refuses to overwrite a newer row', () => {
		expect(() => withReminderSettings({ version: 2 }, { enabled: true })).toThrow(/newer/);
	});
});

describe('saveReminderSettings', () => {
	it('re-reads the row, then writes the merge', async () => {
		const calls: string[] = [];
		const store = {
			find: vi.fn(async () => {
				calls.push('find');
				return { version: 1, enabled: false, keep: true };
			}),
			put: vi.fn(async (_k: string, v: unknown) => {
				calls.push('put');
				return v as never;
			})
		};
		const out = await saveReminderSettings({ enabled: true }, store);
		expect(calls).toEqual(['find', 'put']);
		expect(store.put).toHaveBeenCalledWith(REMINDERS_KEY, { version: 1, enabled: true, keep: true });
		expect(out.enabled).toBe(true);
	});
	it('does not write over a newer row', async () => {
		const store = { find: async () => ({ version: 9 }), put: vi.fn() };
		await expect(saveReminderSettings({ enabled: true }, store as never)).rejects.toThrow();
		expect(store.put).not.toHaveBeenCalled();
	});
	it('exports the defaults', () => expect(defaultReminderSettings().enabled).toBe(false));
});

describe('loadReminderRow', () => {
	it('reads the settings and whether the row is from a newer version', async () => {
		const { loadReminderRow } = await import('./settings');
		expect(await loadReminderRow({ find: async () => null })).toEqual({ settings: defaultReminderSettings(), newer: false });
		expect((await loadReminderRow({ find: async () => ({ version: 1, enabled: true }) })).settings.enabled).toBe(true);
		const newer = await loadReminderRow({ find: async () => ({ version: 2, enabled: true }) });
		expect(newer).toMatchObject({ newer: true });
		expect(newer.settings.enabled).toBe(true);
	});
});
