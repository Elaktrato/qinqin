import { describe, expect, it } from 'vitest';
import {
	PERMISSIONS,
	PERMISSION_LABELS,
	builtinManifests,
	logChangingTypes,
	sdkSupported
} from './contract';

describe('sdkSupported', () => {
	it('accepts exactly the supported integer sdk', () => {
		expect(sdkSupported({ sdk: 1 })).toBe(true);
	});
	it('rejects everything else', () => {
		expect(sdkSupported({})).toBe(false);
		expect(sdkSupported({ sdk: '1' })).toBe(false);
		expect(sdkSupported({ sdk: 2 })).toBe(false);
		expect(sdkSupported({ sdk: 1.5 })).toBe(false);
		expect(sdkSupported(null)).toBe(false);
		expect(sdkSupported('x')).toBe(false);
	});
});

describe('logChangingTypes', () => {
	it('is the event types of every non-core built-in', () => {
		expect([...logChangingTypes()].sort()).toEqual(['journal', 'read', 'review']);
	});
});

describe('builtinManifests', () => {
	it('lists core, flashcards, reader, journal, grammar, all on the supported sdk', () => {
		const list = builtinManifests();
		expect(list.map((m) => m.id)).toEqual([
			'qinqin-core',
			'qinqin-flashcards',
			'qinqin-reader',
			'qinqin-journal',
			'qinqin-grammar'
		]);
		expect(list.every((m) => sdkSupported(m))).toBe(true);
	});
});

describe('PERMISSION_LABELS', () => {
	it('has a plain, non-empty label for every permission', () => {
		for (const permission of PERMISSIONS) {
			expect(PERMISSION_LABELS[permission].length).toBeGreaterThan(0);
		}
	});
});
