// Builds what the suite runs against: the real qinqin binary with the built
// SPA embedded (as the Dockerfile and scripts/smoke-embed.sh do), and a
// template data directory holding the fixture packs and the admin user.
// Workers copy the template, so no worker ever seeds.

import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export const webRoot = resolve(here, '..', '..');
export const repoRoot = resolve(webRoot, '..', '..');
export const fixturePacks = resolve(here, '..', 'fixtures', 'packs');

/** The admin of every e2e instance; the password exists only in the throw-away data directory. */
export const ADMIN = { username: 'e2e-admin', password: 'e2e-admin-Passw0rd!' } as const;

/**
 * The SPA build the binary embeds: apps/web/build, built afresh so the suite
 * never tests a stale build. QINQIN_E2E_REUSE_BUILD=1 reuses the existing one
 * (CI, which has just built it).
 */
function webBuild(): string {
	const build = join(webRoot, 'build');
	if (process.env.QINQIN_E2E_REUSE_BUILD === '1') {
		if (!existsSync(join(build, 'index.html'))) throw new Error('QINQIN_E2E_REUSE_BUILD=1 but apps/web/build has no index.html');
		return build;
	}
	execFileSync('npm', ['run', 'build'], { cwd: webRoot, stdio: 'inherit' });
	return build;
}

/**
 * buildBinary copies server/ to a scratch directory, puts the SPA build where
 * go:embed expects it (internal/webdist/dist) and builds the binary there:
 * the worktree is not modified.
 */
export function buildBinary(work: string): string {
	const build = webBuild();
	const src = join(work, 'src');
	const bin = join(work, 'qinqin');
	try {
		// Skipped: a local data directory and a stale embed copy.
		const skip = new Set([join(repoRoot, 'server', 'data'), join(repoRoot, 'server', 'internal', 'webdist', 'dist')]);
		cpSync(join(repoRoot, 'server'), src, { recursive: true, filter: (path) => !skip.has(path) });
		rmSync(join(src, 'internal', 'webdist', 'dist'), { recursive: true, force: true });
		cpSync(build, join(src, 'internal', 'webdist', 'dist'), { recursive: true });
		execFileSync('go', ['build', '-trimpath', '-o', bin, './cmd/qinqin'], {
			cwd: src,
			stdio: 'inherit',
			env: { ...process.env, CGO_ENABLED: '0', GOFLAGS: '-buildvcs=false' }
		});
	} finally {
		rmSync(src, { recursive: true, force: true });
	}
	return bin;
}

/**
 * A throw-away secret per test process: it seals the fake AI keys the
 * conversation spec stores, on a server that is deleted with the run.
 */
const AI_SECRET = randomBytes(32).toString('base64');

/** The environment every qinqin process of the suite gets: no network services, no proxy, no seed, the fake AI. */
export function serverEnv(packs: string): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = {};
	for (const key of ['PATH', 'HOME', 'TMPDIR', 'GOCOVERDIR']) {
		if (process.env[key] !== undefined) env[key] = process.env[key];
	}
	return {
		...env,
		// No first-start seed: the template already holds the fixture packs.
		QINQIN_AUTO_SEED: '0',
		// An empty pack root: no bundled strokes or lemma packs are installed at start.
		QINQIN_PACKS: packs,
		// The fixture logs in through X-Forwarded-For (one address per test), so the
		// per-address sign-in limit never trips across tests.
		QINQIN_TRUSTED_PROXIES: '127.0.0.1',
		// The deterministic fake AI provider (server/internal/ai/fake.go): it never
		// touches the network. A learner without a stored key still sees "no key".
		QINQIN_AI_PROVIDER: 'fake',
		QINQIN_SECRET: AI_SECRET
	};
}

/**
 * makeTemplate seeds the fixture packs into a fresh data directory and adds
 * the admin. Takes well under a second (the full first-start seed takes minutes).
 */
export function makeTemplate(bin: string, work: string): string {
	const data = join(work, 'template');
	const packs = join(work, 'no-packs');
	mkdirSync(packs, { recursive: true });
	const env = serverEnv(packs);
	execFileSync(bin, ['seed', '--data', data, '--packs', fixturePacks], { env, stdio: 'pipe' });
	execFileSync(bin, ['adduser', '--data', data, '--username', ADMIN.username, '--admin'], {
		env: { ...env, QINQIN_PASSWORD: ADMIN.password },
		stdio: 'pipe'
	});
	return data;
}

export function scratchDir(prefix: string): string {
	return mkdtempSync(join(tmpdir(), prefix));
}
