import { describe, expect, it } from 'vitest';
import pkg from '../../package.json';
import { APP_NAME, APP_NAME_HANZI, APP_VERSION } from './app';

describe('app identity', () => {
	it('names the app', () => {
		expect(APP_NAME).toBe('qinqin');
	});

	it('spells the name in hanzi for the header logo', () => {
		expect(APP_NAME_HANZI).toBe('勤勤');
	});

	it('reports the web package version for the footer', () => {
		expect(APP_VERSION).toBe(pkg.version);
		expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+/);
	});
});
