// Tests of the release version rules: the tag guard and the monotonic versionCode (npm test, vitest).
import { describe, expect, test } from 'vitest';
import { VersionError, androidVersion, parseTag } from './version-code.mjs';

describe('parseTag', () => {
	test('strips one leading v and splits the parts', () => {
		expect(parseTag('v0.7.0')).toMatchObject({ name: '0.7.0', major: 0, minor: 7, patch: 0, pre: null });
		expect(parseTag('1.2.3')).toMatchObject({ name: '1.2.3' });
		expect(parseTag('v0.7.0-rc.1')).toMatchObject({ name: '0.7.0-rc.1', pre: 'rc.1' });
	});

	test.each(['', 'v', 'v1', 'v1.2', 'v1.2.3.4', 'vv1.2.3', 'v01.2.3', 'v1.2.3-', 'v1.2.3+build', 'latest', 'v1.2.x', ' v1.2.3'])(
		'rejects %j',
		(tag) => {
			expect(() => parseTag(tag)).toThrow(VersionError);
		}
	);
});

describe('androidVersion', () => {
	test('code is major*1000000 + minor*10000 + patch*100 + slot, release slot 99', () => {
		expect(androidVersion('v0.7.0')).toEqual({ versionName: '0.7.0', versionCode: 70099 });
		expect(androidVersion('v1.2.3')).toEqual({ versionName: '1.2.3', versionCode: 1020399 });
		expect(androidVersion('v0.0.0')).toEqual({ versionName: '0.0.0', versionCode: 99 });
	});

	test('pre-release slots: alpha 1-29, beta 30-59, rc 60-89, below the release', () => {
		const code = (t) => androidVersion(t).versionCode;
		expect(code('v0.7.0-alpha.1')).toBe(70001);
		expect(code('v0.7.0-beta.1')).toBe(70030);
		expect(code('v0.7.0-rc.1')).toBe(70060);
		expect(code('v0.7.0-rc.30')).toBe(70089);
	});

	test('is strictly increasing along the semver order', () => {
		const order = ['v0.6.0', 'v0.7.0-alpha.1', 'v0.7.0-alpha.2', 'v0.7.0-beta.1', 'v0.7.0-rc.1', 'v0.7.0-rc.2', 'v0.7.0', 'v0.7.1-rc.1', 'v0.7.1', 'v0.10.0', 'v1.0.0'];
		const codes = order.map((t) => androidVersion(t).versionCode);
		for (let i = 1; i < codes.length; i++) expect(codes[i]).toBeGreaterThan(codes[i - 1]);
	});

	test.each(['v0.7.0-nightly', 'v0.7.0-rc', 'v0.7.0-rc1', 'v0.7.0-rc.01', 'v0.7.0-alpha', 'v0.7.0-beta2', 'v0.7.0-RC.1', 'v0.7.0-rc.31', 'v0.7.0-alpha.30', 'v0.7.0-rc.1.2', 'v0.7.0-rc.0', 'v0.7.100', 'v0.100.0', 'v210.0.0'])(
		'refuses %j rather than a code that could collide or not order',
		(tag) => {
			expect(() => androidVersion(tag)).toThrow(VersionError);
		}
	);

	test('the largest accepted version stays within the Play limit of 2100000000', () => {
		expect(androidVersion('v209.99.99').versionCode).toBeLessThanOrEqual(2100000000);
	});
});
