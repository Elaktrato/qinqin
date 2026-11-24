import { describe, expect, it } from 'vitest';
import { loadReadings, saveReadings, type ReadingsStorage } from './readings';

function fake(): ReadingsStorage & { data: Map<string, string> } {
	const data = new Map<string, string>();
	return {
		data,
		getItem: (k) => data.get(k) ?? null,
		setItem: (k, v) => void data.set(k, v)
	};
}

describe('readings preference', () => {
	it('defaults to shown', () => {
		expect(loadReadings(fake())).toBe(true);
		expect(loadReadings(null)).toBe(true);
	});
	it('round-trips under the documented key', () => {
		const s = fake();
		saveReadings(s, false);
		expect(s.data.get('qinqin.grammar.readings')).toBe('0');
		expect(loadReadings(s)).toBe(false);
		saveReadings(s, true);
		expect(loadReadings(s)).toBe(true);
	});
	it('survives a throwing storage', () => {
		const bad: ReadingsStorage = {
			getItem: () => {
				throw new Error('x');
			},
			setItem: () => {
				throw new Error('x');
			}
		};
		expect(loadReadings(bad)).toBe(true);
		expect(() => saveReadings(bad, false)).not.toThrow();
	});
});
