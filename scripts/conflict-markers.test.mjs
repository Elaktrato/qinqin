// No tracked file carries merge conflict markers. A merge that committed them (v0.9.0: the
// contract CHANGELOG after #180) fails here on every branch instead of shipping broken docs:
// node --test scripts/conflict-markers.test.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** markerLines lists the 1-based line numbers of conflict markers in a text. */
export function markerLines(text) {
	const out = [];
	text.split('\n').forEach((line, i) => {
		if (/^(<{7}|>{7}|\|{7})( |$)/.test(line)) out.push(i + 1);
	});
	return out;
}

test('markerLines finds the opening, base and closing markers, not look-alikes', () => {
	const text = ['a', '<<<<<<< HEAD', 'b', '||||||| base', '=======', 'c', '>>>>>>> branch', '<<<<<<<<', '  <<<<<<< x', '>>>>>>>'].join('\n');
	assert.deepEqual(markerLines(text), [2, 4, 7, 10]);
});

test('no tracked text file has merge conflict markers', () => {
	const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
	const bad = [];
	for (const f of files) {
		if (/\.(png|jpe?g|gif|webp|ico|woff2?|ttf|otf|sqlite|qqpkg|zip|gz|jar|keystore|apk|mp3|ogg|wav)$/i.test(f)) continue;
		if (f === 'scripts/conflict-markers.test.mjs') continue;
		let text;
		try {
			text = readFileSync(join(root, f), 'utf8');
		} catch {
			continue;
		}
		if (text.includes('\0')) continue;
		const lines = markerLines(text);
		if (lines.length) bad.push(`${f}:${lines.join(',')}`);
	}
	assert.deepEqual(bad, [], `conflict markers committed: ${bad.join('; ')}`);
});
