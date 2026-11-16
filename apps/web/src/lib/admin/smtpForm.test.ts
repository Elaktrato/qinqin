import { describe, expect, it } from 'vitest';
import type { SmtpSettings } from '$lib/api/adminSettings';
import { draftFrom, needsReentry, passwordNote, payloadFrom, portForMode, testFailure } from './smtpForm';

const saved: SmtpSettings = { configured: true, host: 'mail.example.org', port: 587, tls: 'starttls', username: 'u', password: 'set',
	fromAddress: 'q@example.org', fromName: 'qinqin', publicUrl: 'https://x.example.org', secret: 'ok', allowPrivate: false, updatedAt: 't' };

describe('smtpForm', () => {
	it('never prefills the password and keeps it by default', () => {
		const d = draftFrom(saved);
		expect(d.password).toBe('');
		expect('password' in payloadFrom(d)).toBe(false);
	});
	it('maps the password tri-state', () => {
		const d = draftFrom(saved);
		expect(payloadFrom({ ...d, passwordChoice: 'remove' }).password).toBe('');
		expect(payloadFrom({ ...d, passwordChoice: 'replace', password: 'new-one' }).password).toBe('new-one');
		expect('password' in payloadFrom({ ...d, passwordChoice: 'replace', password: '' })).toBe(false);
	});
	it('trims text fields', () => {
		expect(payloadFrom({ ...draftFrom(saved), host: ' h.example.org ' }).host).toBe('h.example.org');
	});
	it('moves default ports with the mode and keeps custom ones', () => {
		expect(portForMode(587, 'starttls', 'tls')).toBe(465);
		expect(portForMode(465, 'tls', 'none')).toBe(25);
		expect(portForMode(2525, 'starttls', 'tls')).toBe(2525);
	});
	it('words the password state', () => {
		expect(passwordNote('set')).toBe('A password is saved.');
		expect(passwordNote('none')).toBe('No password is saved.');
		expect(passwordNote('undecryptable')).toContain('enter it again');
	});
	it('asks for the password again when the connection changes', () => {
		const d = draftFrom(saved);
		expect(needsReentry(saved, d)).toBe(false);
		expect(needsReentry(saved, { ...d, host: 'other.example.org' })).toBe(true);
		expect(needsReentry(saved, { ...d, host: 'other.example.org', passwordChoice: 'replace', password: 'x' })).toBe(false);
		expect(needsReentry({ ...saved, password: 'none' }, { ...d, host: 'o' })).toBe(false);
		// reset links carry the public URL: a new one needs the password again too
		expect(needsReentry(saved, { ...d, publicUrl: 'https://elsewhere.example.org' })).toBe(true);
	});
	it('turns a failure category into a sentence', () => {
		expect(testFailure('auth', 535)).toBe('The server refused the user name or password. (server reply 535)');
		expect(testFailure('tls')).toContain('secure connection');
		expect(testFailure('weird')).toBe('The test mail could not be sent.');
	});
});
