import { describe, expect, it } from 'vitest';
import { APP_NAME, APP_NAME_HANZI } from './app';

describe('app identity', () => {
	it('names the app', () => {
		expect(APP_NAME).toBe('qinqin');
	});

	it('spells the name in hanzi for the header logo', () => {
		expect(APP_NAME_HANZI).toBe('勤勤');
	});
});
