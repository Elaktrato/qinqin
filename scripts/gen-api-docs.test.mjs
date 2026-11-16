import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate, renderRoutes } from './gen-api-docs.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('committed wiki API pages match the route fixture and the error catalogue', () => {
	for (const [path, text] of Object.entries(generate(root))) {
		assert.equal(
			readFileSync(resolve(root, path), 'utf8'),
			text,
			`${path} is stale: run node scripts/gen-api-docs.mjs`
		);
	}
});

test('every fixture route appears in the routes page', () => {
	const routes = JSON.parse(readFileSync(resolve(root, 'apps/web/src/lib/pwa/sw/routes.fixture.json'), 'utf8'));
	const page = readFileSync(resolve(root, 'docs/wiki/API-Routes.md'), 'utf8');
	for (const r of routes) {
		const i = r.pattern.indexOf(' ');
		assert.ok(page.includes(`| \`${r.pattern.slice(0, i)}\` | \`${r.pattern.slice(i + 1)}\` | `), r.pattern);
	}
});

test('an unknown access class is refused', () => {
	assert.throws(() => renderRoutes([{ pattern: 'GET /x', access: 'nobody' }]), /unknown access/);
});

test('the routes page has a Token column from tokens-routes.json', () => {
	const tokens = JSON.parse(readFileSync(resolve(root, 'docs/contracts/auth/tokens-routes.json'), 'utf8')).routes;
	const page = readFileSync(resolve(root, 'docs/wiki/API-Routes.md'), 'utf8');
	assert.ok(tokens.length > 20);
	for (const r of tokens) {
		const i = r.pattern.indexOf(' ');
		const label = { any: r.scope, query: `${r.scope} (workspace)`, refused: `${r.scope} (all)` }[r.workspace];
		assert.ok(page.includes(`| \`${r.pattern.slice(0, i)}\` | \`${r.pattern.slice(i + 1)}\` | ${label} |`), r.pattern);
	}
	assert.ok(page.includes('| `POST` | `/api/account/tokens` | — |'));
});

test('a token rule of an unknown kind is refused', () => {
	assert.throws(
		() => renderRoutes([{ pattern: 'GET /x', access: 'user' }], [{ pattern: 'GET /x', scope: 'admin', workspace: 'any' }]),
		/unknown token rule/
	);
	assert.throws(
		() => renderRoutes([{ pattern: 'GET /x', access: 'user' }], [{ pattern: 'GET /y', scope: 'read', workspace: 'any' }]),
		/not a route/
	);
});
