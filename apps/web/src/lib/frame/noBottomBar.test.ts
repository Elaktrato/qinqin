// The bottom tab bar is gone (#99): nothing in src/ keeps clear of it any more.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = join(__dirname, '..', '..');

function files(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) return files(path);
		return /\.(svelte|ts|css)$/.test(name) && !/\.test\.ts$/.test(name) ? [path] : [];
	});
}

describe('no bottom bar', () => {
	it('no source mentions --bottom-bar-height or a bottom scroll padding for it', () => {
		const hits = files(src).filter((path) => /bottom-bar-height|scroll-padding-bottom/.test(readFileSync(path, 'utf8')));
		expect(hits).toEqual([]);
	});
});
