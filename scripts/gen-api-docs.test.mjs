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
		assert.ok(page.includes(`| \`${r.pattern.slice(0, i)}\` | \`${r.pattern.slice(i + 1)}\` |`), r.pattern);
	}
});

test('an unknown access class is refused', () => {
	assert.throws(() => renderRoutes([{ pattern: 'GET /x', access: 'nobody' }]), /unknown access/);
});
