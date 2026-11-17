import { describe, expect, it } from 'vitest';
import { backupError, canCreate, includeBody, PARTS, restoreSteps } from './serverBackupView';

describe('serverBackupView', () => {
	it('builds the include list in a fixed order', () => {
		expect(includeBody(new Set(['audio', 'db']))).toEqual(['db', 'audio']);
		expect(includeBody(new Set(PARTS.map((p) => p.id)))).toEqual(['db', 'books', 'packs', 'audio']);
	});
	it('needs a part and the password', () => {
		expect(canCreate(new Set(['db']), 'pw', false)).toBe(true);
		expect(canCreate(new Set(), 'pw', false)).toBe(false);
		expect(canCreate(new Set(['db']), '', false)).toBe(false);
		expect(canCreate(new Set(['db']), 'pw', true)).toBe(false);
	});
	it('needs the code when the administrator has two-factor sign-in', () => {
		expect(canCreate(new Set(['db']), 'pw', false, true, '')).toBe(false);
		expect(canCreate(new Set(['db']), 'pw', false, true, ' 123456 ')).toBe(true);
	});
	it('words the errors and lists the restore steps', () => {
		expect(backupError('insufficient_storage', 'x')).toContain('free space');
		expect(backupError('backup_running', 'x')).toBe('A backup is already running.');
		expect(backupError('zzz', 'fallback')).toBe('fallback');
		expect(restoreSteps().join(' ')).toContain('QINQIN_SECRET');
	});
});
