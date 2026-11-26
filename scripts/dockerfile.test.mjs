// Every path the Dockerfile copies from the build context exists in the repository, so a
// removed or moved folder fails here on every branch instead of only in the image job on
// main (v0.6.0: the plugin manifests #199 removed were still copied):
// node --test scripts/dockerfile.test.mjs
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * contextSources lists the build-context sources of every COPY and ADD in a Dockerfile.
 * Copies from another stage (--from=) and URLs are skipped; the last argument is the
 * destination. Continuation lines and comments are handled; JSON (exec) form is read too.
 */
export function contextSources(dockerfile) {
	const lines = dockerfile.replace(/\\\r?\n/g, ' ').split(/\r?\n/);
	const out = [];
	for (const raw of lines) {
		const line = raw.trim();
		const m = /^(COPY|ADD)\s+(.*)$/i.exec(line);
		if (!m) continue;
		let args;
		const rest = m[2].trim();
		const flags = [];
		let body = rest;
		while (body.startsWith('--')) {
			const sp = body.search(/\s/);
			flags.push(body.slice(0, sp));
			body = body.slice(sp).trim();
		}
		if (flags.some((f) => f.startsWith('--from='))) continue;
		if (body.startsWith('[')) args = JSON.parse(body);
		else args = body.split(/\s+/);
		for (const src of args.slice(0, -1)) {
			if (/^https?:\/\//.test(src)) continue;
			out.push(src);
		}
	}
	return out;
}

test('contextSources reads sources, skipping stage copies, URLs and the destination', () => {
	const df = [
		'FROM node AS web',
		'COPY apps/web/package.json apps/web/package-lock.json ./',
		'COPY --from=web /src/build ./dist',
		'COPY --chown=1:1 a \\',
		'  b /dest/',
		'ADD https://example.org/x.tgz /x',
		'COPY ["c d", "/e"]',
		'# COPY commented/out /nowhere'
	].join('\n');
	assert.deepEqual(contextSources(df), ['apps/web/package.json', 'apps/web/package-lock.json', 'a', 'b', 'c d']);
});

test('every Dockerfile COPY source exists in the repository', () => {
	const sources = contextSources(readFileSync(join(root, 'Dockerfile'), 'utf8'));
	assert.ok(sources.length > 0, 'the Dockerfile copies something');
	const missing = sources.filter((s) => !existsSync(join(root, s)));
	assert.deepEqual(missing, [], `Dockerfile COPY sources missing from the repository: ${missing.join(', ')}`);
});

test('the image takes its build metadata from build args (#154)', () => {
	const df = readFileSync(join(root, 'Dockerfile'), 'utf8');
	for (const [arg, def] of [['VERSION', 'dev'], ['COMMIT', ''], ['BUILD_DATE', '']]) {
		assert.match(df, new RegExp(`^ARG ${arg}=${def}$`, 'm'), `ARG ${arg}=${def}`);
	}
	for (const [flag, arg] of [['version', 'VERSION'], ['commit', 'COMMIT'], ['buildDate', 'BUILD_DATE']]) {
		assert.ok(df.includes(`-X 'main.${flag}=\${${arg}}'`), `ldflags set main.${flag}`);
	}
	const wf = readFileSync(join(root, '.github/workflows/build.yml'), 'utf8');
	assert.match(wf, /VERSION=\$\{\{ steps\.build\.outputs\.version \}\}/);
	assert.match(wf, /COMMIT=\$\{\{ github\.sha \}\}/);
	assert.match(wf, /BUILD_DATE=\$\{\{ steps\.build\.outputs\.date \}\}/);
	// A build that is not a tag reports "dev".
	assert.match(wf, /version=dev\n\s+case "\$REF" in refs\/tags\/v\*\) version="\$\{REF_NAME#v\}"/);
	// ...and a v* tag that is not semver fails the job instead of reporting dev.
	assert.match(wf, /is not semver/);
});

// The pictures are CC BY-SA 4.0 and stay separate packs (#216): built in their own stage,
// copied into the runtime image as data, never into the Go build (go:embed) or the web build.
test('the pictures stay out of the binary and the web build (#216)', () => {
	const df = readFileSync(join(root, 'Dockerfile'), 'utf8');
	const stage = (name) => {
		const parts = df.split(/^FROM /m).filter((p) => new RegExp(`^\\S+ AS ${name}\\b`).test(p));
		assert.equal(parts.length, 1, `stage ${name} exists`);
		return parts[0];
	};
	assert.match(stage('images'), /prepare-images-pack\.mjs/);
	for (const name of ['web', 'build']) assert.doesNotMatch(stage(name), /images|openmoji|mulberry/i, `the ${name} stage takes no pictures`);
	assert.match(df, /^COPY --from=images \/out \/opt\/qinqin\/images$/m);
	assert.match(df, /QINQIN_PACKS=[^\n]*\/opt\/qinqin\/images/);
	// no Go source embeds a picture or the images directory
	const goSources = readdirSync(join(root, 'server'), { recursive: true }).filter((f) => String(f).endsWith('.go') && !String(f).endsWith('_test.go'));
	const embeds = goSources.flatMap((f) =>
		readFileSync(join(root, 'server', String(f)), 'utf8')
			.split('\n')
			.filter((l) => /^\s*\/\/go:embed/.test(l) && /svg|image|openmoji|mulberry/i.test(l))
	);
	assert.deepEqual(embeds, [], 'no go:embed of a picture');
});
