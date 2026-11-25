import { describe, expect, it } from 'vitest';
import type { UpdateStatus } from '$lib/api/adminUpdate';
import { canCheck, errorNote, safeReleaseUrl, statusLine } from './updateView';

const latest = { version: '0.7.0', tag: 'v0.7.0', name: 'qinqin v0.7.0', url: 'https://github.com/Elaktrato/qinqin/releases/tag/v0.7.0', publishedAt: '2026-11-20T10:00:00Z', prerelease: false, notes: 'n' };
function status(check: Partial<UpdateStatus['check']>, enabled = true): UpdateStatus {
	return {
		installed: { version: '0.6.0', commit: '', buildDate: '' },
		settings: { enabled, prereleases: false },
		check: { state: 'ok', stale: false, latest, update: 'available', checkedAt: '2026-11-25T12:00:00Z', ...check }
	};
}

describe('statusLine', () => {
	it('says what each relation means', () => {
		expect(statusLine(status({}))).toBe('Version 0.7.0 is available.');
		expect(statusLine(status({ update: 'current' }))).toBe('You are up to date.');
		expect(statusLine(status({ update: 'ahead' }))).toContain('newer');
		expect(statusLine(status({ update: 'unknown' }))).toContain('cannot be compared');
	});
	it('says disabled, unchecked, offline and no release', () => {
		expect(statusLine(status({ state: 'disabled', latest: null }, false))).toContain('Nothing is sent');
		expect(statusLine(status({ state: 'unchecked', latest: null }))).toBe('Not checked yet.');
		expect(statusLine(status({ state: 'error', error: 'offline', latest: null }))).toContain('Could not reach GitHub');
		expect(statusLine(status({ state: 'error', error: 'rate_limited', latest: null }))).toContain('rate limit');
		expect(statusLine(status({ latest: null }))).toBe('No release has been published yet.');
	});
});

describe('errorNote', () => {
	it('adds the offline note beside the last known release only', () => {
		expect(errorNote(status({}))).toBe('');
		expect(errorNote(status({ state: 'error', error: 'offline', stale: true }))).toContain('Could not reach GitHub. The server may be offline. Showing the last known release.');
		expect(errorNote(status({ state: 'error', error: 'offline', latest: null }))).toBe('');
	});
});

describe('canCheck and safeReleaseUrl', () => {
	it('blocks check now while off, busy or unloaded', () => {
		expect(canCheck(status({}), false)).toBe(true);
		expect(canCheck(status({}, false), false)).toBe(false);
		expect(canCheck(status({}), true)).toBe(false);
		expect(canCheck(null, false)).toBe(false);
	});
	it('links only to GitHub', () => {
		expect(safeReleaseUrl(latest.url)).toBe(latest.url);
		expect(safeReleaseUrl('javascript:alert(1)')).toBeNull();
	});
});
