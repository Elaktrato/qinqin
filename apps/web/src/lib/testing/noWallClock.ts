// The matcher of the wall-clock guard (noWallClock.test.ts,
// docs/architecture/0005-test-conventions.md): what in a test source
// measures elapsed time. Clock arithmetic (Date.now() plus or minus a
// constant), fake timers and busy-waits are not measurements.

const PATTERNS: RegExp[] = [
	/performance\.now\(\)/g,
	// Date.now() minus a variable: a measured duration.
	/Date\.now\(\)\s*-\s*[A-Za-z_$][\w$]*(?!\s*\()/g,
	/process\.hrtime/g,
	/console\.time\(/g
];

/** The wall-clock measurements in a test source, in pattern order. */
export function wallClockFindings(src: string): string[] {
	// Quoted text and line comments are not code (a template literal is kept:
	// its substitutions run).
	const code = src.replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|\/\/[^\n]*/g, '""');
	const out: string[] = [];
	for (const p of PATTERNS) for (const m of code.matchAll(p)) out.push(m[0]);
	return out;
}
