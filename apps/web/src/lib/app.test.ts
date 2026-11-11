import { describe, expect, it } from 'vitest';
import { APP_NAME } from './app';

describe('app identity', () => {
	it('names the app', () => {
		expect(APP_NAME).toBe('qinqin');
	});
});
