import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import format from '../../../../../docs/contracts/auth/tokens-format.json';
import tokens from '../../../../../docs/contracts/auth/tokens.json';
import errors from '../../../../../docs/contracts/auth/errors.json';
import { TOKEN_PREFIX, TOKEN_RE, isTokenShaped, tokenHint } from './tokensFormat';

// docs/contracts/auth/tokens-format.json and tokens.json: the shape of a
// personal access token and the bodies of the token routes.
describe('tokens-format.json', () => {
	it('publishes the scanner regex this module uses', () => {
		expect(format.regex).toBe(TOKEN_RE.source);
		expect(format.prefix).toBe(TOKEN_PREFIX);
	});

	it.each(format.valid)('accepts %s', (s) => expect(isTokenShaped(s)).toBe(true));
	it.each(format.invalid)('refuses %j', (s) => expect(isTokenShaped(s)).toBe(false));

	it.each(format.hint)('hint of $token is $hint', ({ token, hint }) => expect(tokenHint(token)).toBe(hint));

	it('hint of a malformed string is empty', () => expect(tokenHint('qq_pat_xyz')).toBe(''));

	it('stores hex SHA-256 of the whole string (fixed test value, never a real token)', () => {
		expect(format.sha256.token).toBe(TOKEN_PREFIX + '0'.repeat(64));
		expect(createHash('sha256').update(format.sha256.token).digest('hex')).toBe(format.sha256.hash);
	});
});

describe('tokens.json', () => {
	const cases = Object.entries(tokens).filter(([k]) => !k.startsWith('_')) as [string, { request: { method: string; path: string }; status: number; body: unknown }][];
	const catalogue = errors as unknown as Record<string, { status: number }>;

	it('has every case of the plan', () => {
		expect(cases.map(([k]) => k).sort()).toEqual(
			[
				'create',
				'create_limited',
				'list',
				'revoke_one',
				'revoke_all',
				'not_allowed',
				'read_only',
				'workspace',
				'limit',
				'invalid_name',
				'invalid_days',
				'wrong_password',
				'unauthorized_expired',
				'foreign_revoke'
			].sort()
		);
	});

	it.each(cases)('%s has request, status and body', (_, c) => {
		expect(c.request.method).toMatch(/^(GET|POST|PUT|DELETE)$/);
		expect(c.request.path.startsWith('/api/')).toBe(true);
		expect(typeof c.status).toBe('number');
		expect('body' in c).toBe(true);
	});

	it.each(cases.filter(([, c]) => c.body && typeof c.body === 'object' && 'error' in (c.body as object)))(
		'%s names a catalogued code with its status',
		(_, c) => {
			const code = (c.body as { error: string }).error;
			expect(catalogue[code], code).toBeDefined();
			expect(catalogue[code].status).toBe(c.status);
		}
	);

	it('shows a token only in the create answers, as the placeholder', () => {
		const text = JSON.stringify(tokens);
		expect(text).not.toMatch(/qq_pat_[0-9a-f]{64}/);
		for (const [name, c] of cases) {
			const body = JSON.stringify(c.body ?? null);
			if (name === 'create' || name === 'create_limited') {
				expect((c.body as { token: string }).token).toBe('<token>');
			} else {
				expect(body).not.toContain('"token"');
			}
		}
	});

	it('list rows carry no secret', () => {
		const rows = (tokens.list.body as { accessTokens: Record<string, unknown>[] }).accessTokens;
		expect(rows.length).toBeGreaterThan(0);
		for (const r of rows) {
			expect(Object.keys(r).sort()).toEqual(
				['id', 'name', 'hint', 'scope', 'workspaceId', 'createdAt', 'expiresAt', 'lastUsedAt', 'expired'].sort()
			);
		}
	});
});

describe('errors.json', () => {
	it.each([
		['token_not_allowed', 403],
		['token_read_only', 403],
		['token_workspace', 403],
		['token_limit', 409],
		['invalid_token_request', 422]
	])('has %s (%d)', (code, status) => {
		expect((errors as unknown as Record<string, { status: number }>)[code]?.status).toBe(status);
	});

	it('unauthorized also covers access tokens', () => {
		expect(errors.unauthorized.meaning).toContain('access token');
	});
});
