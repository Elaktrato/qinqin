// Tests of the local release script's pure checks (npm test, vitest).
import { describe, expect, test } from 'vitest';
import { CheckError, checkBadging, comparePinned, normalizeFingerprint, parseApksigner, parseBadging, readPinned } from './release-checks.mjs';

const FP = 'ab'.repeat(32);
const good = `Verifies
Verified using v1 scheme (JAR signing): false
Verified using v2 scheme (APK Signature Scheme v2): true
Verified using v3 scheme (APK Signature Scheme v3): true
Number of signers: 1
Signer #1 certificate DN: CN=qinqin
Signer #1 certificate SHA-256 digest: ${FP}
`;

describe('normalizeFingerprint', () => {
	test('accepts hex, colons, case and spaces', () => {
		expect(normalizeFingerprint(FP.toUpperCase())).toBe(FP);
		expect(normalizeFingerprint(FP.match(/../g).join(':'))).toBe(FP);
	});
	test.each(['', 'abc', 'zz'.repeat(32), 'ab'.repeat(31), null])('rejects %s', (v) => expect(normalizeFingerprint(v)).toBeNull());
});

describe('parseApksigner', () => {
	test('returns the fingerprint of a verified v2 signature', () => expect(parseApksigner(good)).toEqual({ fingerprint: FP }));
	test('refuses a missing or false v2 verification', () => {
		expect(() => parseApksigner(good.replace('Scheme v2): true', 'Scheme v2): false'))).toThrow(CheckError);
		expect(() => parseApksigner('DOES NOT VERIFY')).toThrow(/v2/);
	});
	test('refuses output without a digest', () => expect(() => parseApksigner(good.replace(/^Signer #1 certificate SHA-256.*$/m, ''))).toThrow(/digest/));
	test('refuses the debug certificate', () => expect(() => parseApksigner(good.replace('CN=qinqin', 'C=US, O=Android, CN=Android Debug'))).toThrow(/debug/));
});

describe('badging', () => {
	const out = "package: name='io.x.qinqin' versionCode='70099' versionName='0.7.0' compileSdkVersion='35'\nsdkVersion:'24'\n";
	test('parses', () => expect(parseBadging(out)).toEqual({ id: 'io.x.qinqin', versionCode: '70099', versionName: '0.7.0' }));
	test('accepts the expected version', () => expect(checkBadging(out, 70099, '0.7.0').id).toBe('io.x.qinqin'));
	test('refuses a different code or name', () => {
		expect(() => checkBadging(out, 70098, '0.7.0')).toThrow(/versionCode/);
		expect(() => checkBadging(out, 70099, '0.7.1')).toThrow(/versionName/);
		expect(() => checkBadging('', 1, '1.0.0')).toThrow(CheckError);
	});
});

describe('the pinned fingerprint', () => {
	test('readPinned ignores comments and blank lines', () => expect(readPinned(`# the key\n\n${FP}\n`)).toBe(FP));
	test('readPinned: only comments means none', () => expect(readPinned('# nothing yet\n')).toBeNull());
	test('readPinned refuses two lines and garbage', () => {
		expect(() => readPinned(`${FP}\n${FP}`)).toThrow(CheckError);
		expect(() => readPinned('hello')).toThrow(CheckError);
	});
	test('comparePinned', () => {
		expect(comparePinned(FP, null)).toBe('unpinned');
		expect(comparePinned(FP, '# x')).toBe('unpinned');
		expect(comparePinned(FP, FP.toUpperCase())).toBe('match');
		expect(comparePinned(FP, 'cd'.repeat(32))).toBe('mismatch');
	});
});
