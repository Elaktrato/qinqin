import { describe, expect, it } from 'vitest';
import { IDLE_CUTOFF_MS, MIN_BURST_SECONDS, createReadingTimer } from './readingTimer';
import payloadsFixture from '../../../../../../docs/contracts/events/payloads.json';

const S = 1000;

describe('createReadingTimer', () => {
	it('accrues time between consecutive activity calls', () => {
		const t = createReadingTimer();
		t.activity(0);
		t.activity(60 * S);
		expect(t.flush(60 * S)).toBe(60);
	});

	it('caps an idle gap at the cut-off', () => {
		const t = createReadingTimer();
		t.activity(0);
		t.activity(10 * 60 * S);
		expect(t.flush(10 * 60 * S)).toBe(IDLE_CUTOFF_MS / S);
	});

	it('does not accrue while hidden and resumes on visible', () => {
		const t = createReadingTimer();
		t.activity(0);
		t.activity(40 * S);
		t.hidden(50 * S); // +10 s, then the clock stops
		t.activity(500 * S); // ignored while hidden
		t.visible(1000 * S);
		t.activity(1040 * S); // +40 s
		expect(t.flush(1040 * S)).toBe(90);
	});

	it('returns 0 below the minimum burst and carries the seconds over', () => {
		const t = createReadingTimer();
		t.activity(0);
		t.activity((MIN_BURST_SECONDS - 1) * S);
		expect(t.flush((MIN_BURST_SECONDS - 1) * S)).toBe(0);
		t.activity((MIN_BURST_SECONDS + 9) * S);
		expect(t.flush((MIN_BURST_SECONDS + 9) * S)).toBe(MIN_BURST_SECONDS + 9);
	});

	it('resets after a flush so seconds are never counted twice', () => {
		const t = createReadingTimer();
		t.activity(0);
		t.activity(100 * S);
		expect(t.flush(100 * S)).toBe(100);
		expect(t.flush(100 * S)).toBe(0);
		t.activity(130 * S);
		expect(t.flush(130 * S)).toBe(30);
	});

	it('keeps the fractional remainder after a flush', () => {
		const t = createReadingTimer();
		t.activity(0);
		t.activity(60_500);
		expect(t.flush(60_500)).toBe(60);
		t.activity(90_000); // 29.5 s gap + 0.5 s remainder
		expect(t.flush(90_000)).toBe(30);
	});

	it('adds nothing when the clock goes backwards, and recovers', () => {
		const t = createReadingTimer();
		t.activity(100 * S);
		t.activity(50 * S);
		expect(t.accrued()).toBe(0);
		t.activity(100 * S);
		expect(t.accrued()).toBe(50 * S);
	});

	it('ignores hidden/visible misuse without throwing', () => {
		const t = createReadingTimer();
		t.visible(0);
		t.hidden(10 * S);
		t.hidden(20 * S);
		expect(t.flush(20 * S)).toBe(0);
	});
});

describe('docs/contracts/events/payloads.json: when a read event is emitted', () => {
	interface Step {
		op: 'activity' | 'hidden' | 'visible' | 'flush' | 'accrued';
		at?: number;
		expect?: number;
	}
	const fixture = payloadsFixture as unknown as {
		constants: { minBurstSeconds: number; idleCutoffMs: number };
		cases: { kind: string; type: string; name: string; steps?: Step[] }[];
	};
	it('uses the constants of the fixture', () => {
		expect(MIN_BURST_SECONDS).toBe(fixture.constants.minBurstSeconds);
		expect(IDLE_CUTOFF_MS).toBe(fixture.constants.idleCutoffMs);
	});
	for (const c of fixture.cases.filter((x) => x.kind === 'emit' && x.type === 'read')) {
		it(c.name, () => {
			const t = createReadingTimer();
			for (const s of c.steps!) {
				if (s.op === 'flush') expect(t.flush(s.at!)).toBe(s.expect);
				else if (s.op === 'accrued') expect(t.accrued()).toBe(s.expect);
				else t[s.op](s.at!);
			}
		});
	}
});
