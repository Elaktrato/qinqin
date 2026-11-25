// The matcher of the wall-clock guard (noWallClock.test.ts,
// docs/architecture/0005-test-conventions.md): what in a test source
// measures elapsed time. Clock arithmetic with a constant (Date.now() minus
// DAY or a number), fake timers, busy-waits and a clock value passed to the
// code under test are not measurements.

/** A read of the wall clock. */
const CLOCK = String.raw`(?:Date\.now\(\)|performance\.now\(\)|new Date\(\)\.(?:getTime|valueOf)\(\)|\+\s*new Date\(\))`;
/** An identifier that is not an ALL_CAPS constant. */
const VARIABLE = String.raw`(?![A-Z][A-Z0-9_]*\b)[A-Za-z_$][\w$]*\b(?!\s*\()`;

const PATTERNS: RegExp[] = [
	/performance\.now\(\)/g,
	// Date.now() minus a variable (not a constant, not a call): a measured duration.
	new RegExp(String.raw`Date\.now\(\)\s*-\s*${VARIABLE}`, 'g'),
	/process\.hrtime/g,
	/console\.time\(/g
];

const escape = (s: string): string => s.replace(/[$]/g, '\\$');

/** Quoted text and comments are not code (a template literal is kept: its substitutions run). */
function code(src: string): string {
	return src.replace(/\/\*[\s\S]*?\*\/|'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|\/\/[^\n]*/g, (m) =>
		m.startsWith('/*') ? m.replace(/[^\n]/g, ' ') : '""'
	);
}

/** The wall-clock measurements in a test source. */
export function wallClockFindings(src: string): string[] {
	const text = code(src);
	const out: string[] = [];
	const flaggedLines = new Set<number>();
	const lineOf = (index: number): number => text.slice(0, index).split('\n').length;
	for (const p of PATTERNS)
		for (const m of text.matchAll(p)) {
			out.push(m[0]);
			flaggedLines.add(lineOf(m.index ?? 0));
		}

	// Clock stamps: variables assigned a clock read. Durations: variables
	// assigned a difference that involves a clock read or a stamp.
	const stamps = new Set<string>();
	for (const m of text.matchAll(new RegExp(String.raw`\b([A-Za-z_$][\w$]*)\s*=\s*${CLOCK}`, 'g'))) stamps.add(m[1]);
	const timed = (): string => [CLOCK, ...[...stamps].map((s) => String.raw`\b${escape(s)}\b`)].join('|');
	const difference = (): RegExp =>
		new RegExp(String.raw`(?:${timed()})\s*-\s*(?:${CLOCK}|${VARIABLE})|${VARIABLE}\s*-\s*(?:${timed()})`);
	const durations = new Set<string>();
	for (const m of text.matchAll(/\b([A-Za-z_$][\w$]*)\s*=([^;\n]*)/g)) if (difference().test(m[2])) durations.add(m[1]);

	// An expectation on a difference, on a duration, or on the clock itself (a deadline).
	const lines = text.split('\n');
	lines.forEach((line, i) => {
		const at = line.indexOf('expect(');
		if (at < 0 || flaggedLines.has(i + 1)) return;
		const arg = line.slice(at + 'expect('.length);
		const onDuration = [...durations].some((d) => new RegExp(String.raw`\b${escape(d)}\b`).test(arg));
		if (difference().test(arg) || onDuration || new RegExp(`^\\s*${CLOCK}`).test(arg)) out.push(line.slice(at).trim());
	});
	return out;
}
