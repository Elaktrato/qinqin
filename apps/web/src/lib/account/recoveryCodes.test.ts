import { describe, expect, it } from 'vitest';
import { recoveryClipboard, recoveryFileName, recoveryText } from './recoveryCodes';

const codes = ['AAAA-BBBB-CCCC-DDDD', 'EEEE-FFFF-GGGG-HHHH'];
const day = new Date('2026-11-15T12:00:00Z');

describe('recoveryCodes', () => {
	it('writes one code per line under the instructions', () => {
		const text = recoveryText(codes, 'words.example.org', day);
		expect(text.split('\n')).toEqual([
			'qinqin recovery codes for words.example.org',
			'Made on 2026-11-15.',
			'',
			'Each code works once, when you cannot use your authenticator app.',
			'Keep this file somewhere safe and private.',
			'',
			'AAAA-BBBB-CCCC-DDDD',
			'EEEE-FFFF-GGGG-HHHH',
			''
		]);
	});
	it('names the file by day and copies plain lines', () => {
		expect(recoveryFileName(day)).toBe('qinqin-recovery-codes-2026-11-15.txt');
		expect(recoveryClipboard(codes)).toBe('AAAA-BBBB-CCCC-DDDD\nEEEE-FFFF-GGGG-HHHH');
	});
});
