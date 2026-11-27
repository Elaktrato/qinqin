import { describe, expect, it } from 'vitest';
import { RefreshReport } from './refreshReport.svelte';

describe('RefreshReport (#290)', () => {
	it('a failed background refresh is reported for its workspace until that source refreshes again', () => {
		const report = new RefreshReport();
		expect(report.failed(1)).toBe(false);
		report.record('study', 1, false);
		report.record('log', 1, false);
		expect(report.failed(1)).toBe(true);
		expect(report.failed(2)).toBe(false);
		report.record('study', 1, true);
		expect(report.failed(1)).toBe(true);
		report.record('log', 1, true);
		expect(report.failed(1)).toBe(false);
	});

	it('clear forgets every failure (the session end)', () => {
		const report = new RefreshReport();
		report.record('study', 1, false);
		report.clear();
		expect(report.failed(1)).toBe(false);
	});
});
