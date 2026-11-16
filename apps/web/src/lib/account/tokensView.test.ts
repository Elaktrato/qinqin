import { describe, expect, it } from 'vitest';
import fixture from '../../../../../docs/contracts/auth/tokens.json';
import {
	DEFAULT_EXPIRY,
	EXPIRY_CHOICES,
	containmentNote,
	exampleCommand,
	expiryText,
	tokenRows,
	validateTokenForm,
	type TokenDto
} from './tokensView';

const now = new Date('2026-11-16T12:05:00Z');
const list = fixture.list.body.accessTokens as TokenDto[];

describe('tokenRows', () => {
	it('decodes the list fixture', () => {
		const rows = tokenRows(list, [{ id: 3, name: 'Chinese' }], now, 'UTC');
		expect(rows.map((r) => r.id)).toEqual([5, 4]);
		expect(rows[0]).toMatchObject({
			name: 'reader export',
			masked: 'qq_pat_08b2e7…',
			scopeLabel: 'Read only',
			workspaceLabel: 'Chinese',
			expiryText: 'Expires in 7 days',
			lastUsedText: 'Never used',
			expired: false
		});
		expect(rows[1]).toMatchObject({
			masked: 'qq_pat_3f9a1c…',
			scopeLabel: 'Read and write',
			workspaceLabel: 'All workspaces',
			lastUsedText: 'Last used just now'
		});
	});

	it('names a workspace that is gone and an unnamed one', () => {
		const one = { ...list[0], workspaceId: 99 };
		expect(tokenRows([one], [], now, 'UTC')[0].workspaceLabel).toBe('Deleted workspace');
		expect(tokenRows([{ ...list[0], workspaceId: 3 }], [{ id: 3, name: '  ' }], now, 'UTC')[0].workspaceLabel).toBe('Workspace 3');
	});

	it('marks expired tokens in words', () => {
		const row = tokenRows([{ ...list[0], expired: true, expiresAt: '2026-11-01T00:00:00Z' }], [], now, 'UTC')[0];
		expect(row.expiryText).toBe('Expired');
		expect(row.expired).toBe(true);
	});

	it('words last use with the session wording', () => {
		const row = tokenRows([{ ...list[0], lastUsedAt: '2026-11-16T11:00:00Z' }], [], now, 'UTC')[0];
		expect(row.lastUsedText).toBe('Last used 1 hour ago');
	});
});

describe('expiryText', () => {
	it.each([
		['2026-11-28T12:05:00Z', false, 'Expires in 12 days'],
		['2026-11-17T12:05:00Z', false, 'Expires in 1 day'],
		['2026-11-17T00:05:00Z', false, 'Expires in 12 hours'],
		['2026-11-16T13:05:00Z', false, 'Expires in 1 hour'],
		['2026-11-16T12:30:00Z', false, 'Expires in less than an hour'],
		['2026-11-16T12:00:00Z', false, 'Expired'],
		['2027-02-14T12:00:00Z', true, 'Expired'],
		['nonsense', false, '']
	])('%s (expired %s) -> %s', (iso, expired, want) => expect(expiryText(iso, expired as boolean, now)).toBe(want));
});

describe('validateTokenForm', () => {
	const ok = { name: 'cron sync', scope: 'read', days: DEFAULT_EXPIRY, password: 'pw' };
	it('accepts a good form', () => expect(validateTokenForm(ok)).toEqual({ ok: true }));
	it.each([
		[{ ...ok, name: '   ' }, 'name'],
		[{ ...ok, name: '字'.repeat(65) }, 'name'],
		[{ ...ok, scope: 'admin' }, 'scope'],
		[{ ...ok, days: 0 }, 'days'],
		[{ ...ok, days: 366 }, 'days'],
		[{ ...ok, days: 1.5 }, 'days'],
		[{ ...ok, password: '' }, 'password']
	])('refuses %j (%s)', (f, field) => {
		const r = validateTokenForm(f);
		expect(r.ok).toBe(false);
		if (!r.ok) {
			expect(r.field).toBe(field);
			expect(r.message.length).toBeGreaterThan(0);
		}
	});
	it('counts characters, not UTF-16 units', () => expect(validateTokenForm({ ...ok, name: '𠀀'.repeat(64) })).toEqual({ ok: true }));
});

describe('choices', () => {
	it('offers 7, 30, 90 and 365 days, 90 by default', () => {
		expect([...EXPIRY_CHOICES]).toEqual([7, 30, 90, 365]);
		expect(DEFAULT_EXPIRY).toBe(90);
	});
});

describe('exampleCommand', () => {
	it('lists workspaces with the token', () => {
		expect(exampleCommand('https://qinqin.example.org', '<token>')).toBe(
			`curl -sS -H "Authorization: Bearer <token>" https://qinqin.example.org/api/workspaces`
		);
	});
	it('drops a trailing slash of the origin', () => {
		expect(exampleCommand('http://localhost:5173/', 't')).toBe(`curl -sS -H "Authorization: Bearer t" http://localhost:5173/api/workspaces`);
	});
});

describe('containmentNote', () => {
	it('speaks only when tokens exist', () => {
		expect(containmentNote(0)).toBeNull();
		expect(containmentNote(2)).toBe('Your access tokens are revoked too.');
	});
});
