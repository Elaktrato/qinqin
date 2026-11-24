// Guard (docs/architecture/0005-test-conventions.md): a unit test asserts no
// wall-clock time limit. A loaded machine makes such a test fail with no
// change to the code; a performance test counts operations instead.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { wallClockFindings } from './noWallClock';

const web = join(__dirname, '..', '..', '..');

function testFiles(dir: string, out: string[] = []): string[] {
	for (const e of readdirSync(dir, { withFileTypes: true })) {
		if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
		const p = join(dir, e.name);
		if (e.isDirectory()) testFiles(p, out);
		else if (/\.test\.(ts|mjs|js)$/.test(e.name)) out.push(p);
	}
	return out;
}

describe('wallClockFindings', () => {
	it('flags a measured duration', () => {
		expect(wallClockFindings('const t0 = performance.now();')).toEqual(['performance.now()']);
		expect(wallClockFindings('expect(Date.now() - started).toBeLessThan(2000);')).toEqual(['Date.now() - started']);
		expect(wallClockFindings('const [s] = process.hrtime();')).toEqual(['process.hrtime']);
		expect(wallClockFindings("console.time('x');")).toEqual(['console.time(']);
	});

	it('flags a duration measured through variables (the evasions)', () => {
		const flagged = [
			'const start = Date.now();\nrun();\nconst end = Date.now();\nexpect(end - start).toBeLessThan(50);',
			'const t0 = new Date().getTime();\nrun();\nexpect(new Date().getTime() - t0).toBeLessThan(50);',
			'let begin = 0;\nbegin = Date.now();\nrun();\nexpect(Date.now() - begin < 50).toBe(true);',
			'const deadline = Date.now() + 1000;\nrun();\nexpect(Date.now()).toBeLessThan(deadline);',
			'const t1 = +new Date();\nrun();\nconst took = +new Date() - t1;\nexpect(took).toBeLessThan(9);'
		];
		for (const src of flagged) expect(wallClockFindings(src).length, src).toBeGreaterThan(0);
	});

	it('does not flag clock arithmetic or fake timers', () => {
		expect(wallClockFindings('new Date(Date.now() - 3 * 86_400_000)')).toEqual([]);
		expect(wallClockFindings('vi.setSystemTime(Date.now() + TTL)')).toEqual([]);
		expect(wallClockFindings('const until = Date.now() + 5; while (Date.now() < until);')).toEqual([]);
		expect(wallClockFindings('settle(state, 1, Date.now());')).toEqual([]);
		expect(wallClockFindings('const due = new Date(Date.now() - DAY);')).toEqual([]);
		expect(wallClockFindings('const a = Date.now() - MAX_AGE_MS;\nexpect(isStale(a)).toBe(true);')).toEqual([]);
		expect(wallClockFindings('const now = Date.now();\nexpect(stamp(now)).toBe(now);')).toEqual([]);
	});

	it('does not flag text in strings and comments', () => {
		expect(wallClockFindings("const rule = 'Date.now() - n * DAY';")).toEqual([]);
		expect(wallClockFindings('const s = "performance.now()";')).toEqual([]);
		expect(wallClockFindings('const s = `${performance.now()}`;')).toEqual(['performance.now()']);
		expect(wallClockFindings('// no performance.now() here')).toEqual([]);
		expect(wallClockFindings('/* performance.now()\n Date.now() - started */ run();')).toEqual([]);
	});
});

describe('no wall-clock assertions in tests', () => {
	it('no test file measures elapsed time', () => {
		const roots = [join(web, 'src'), join(web, 'tests'), join(web, 'scripts'), join(web, '..', '..', 'scripts')];
		const found: string[] = [];
		for (const root of roots) {
			let files: string[];
			try {
				files = testFiles(root);
			} catch {
				continue;
			}
			for (const f of files) {
				if (f.endsWith(join('testing', 'noWallClock.test.ts'))) continue;
				for (const hit of wallClockFindings(readFileSync(f, 'utf8'))) found.push(`${relative(web, f)}: ${hit}`);
			}
		}
		expect(found).toEqual([]);
	});
});
