import { describe, expect, it } from 'vitest';

import runsFixture from '../../../../../docs/contracts/grammar/runs.json';
import { grammarPayload } from '$lib/events/eventPayloads';
import type { StudyEvent } from '$lib/events';
import { GRAMMAR_MAX_EXERCISES, grammarPoint, grammarProgress, grammarRunsOf, parseGrammarRun, splitPoint } from './grammarRuns';

interface Fixture {
	rule: string;
	constants: { maxExercises: number; lessonRunXp: number };
	build: { name: string; args: [string, string, number, number]; expect: unknown }[];
	parse: { name: string; event: StudyEvent; expect: Record<string, unknown> | null }[];
	progress: { name: string; events: StudyEvent[]; expect: Record<string, { best: number; total: number; completedAt: string; runs: number }> }[];
}
const fixture = runsFixture as unknown as Fixture;

describe('docs/contracts/grammar/runs.json', () => {
	it('is the grammar runs rule', () => {
		expect(fixture.rule).toBe('grammar/runs');
		expect(GRAMMAR_MAX_EXERCISES).toBe(fixture.constants.maxExercises);
	});

	for (const c of fixture.build) {
		it(`build: ${c.name}`, () => {
			const built = grammarPayload(...c.args);
			// Member order is part of the shape: the server stores the JSON text as sent.
			expect(JSON.stringify(built)).toBe(JSON.stringify(c.expect));
			expect(grammarPoint(c.args[0], c.args[1])).toBe((c.expect as { point: string }).point);
		});
	}

	for (const c of fixture.parse) {
		it(`parse: ${c.name}`, () => {
			const run = parseGrammarRun(c.event);
			if (c.expect === null) {
				expect(run).toBeNull();
				return;
			}
			expect(run).toEqual({
				...c.expect,
				id: c.event.id,
				workspaceId: c.event.workspaceId,
				ts: c.event.ts,
				at: Date.parse(c.event.ts)
			});
			expect(splitPoint(run!.point)).toEqual({ packId: c.expect.packId, lessonId: c.expect.lessonId });
		});
	}

	for (const c of fixture.progress) {
		it(`progress: ${c.name}`, () => {
			const progress = grammarProgress(grammarRunsOf(7, c.events));
			expect(Object.fromEntries(progress)).toEqual(c.expect);
		});
	}
});

describe('grammarRunsOf', () => {
	it('keeps the runs of the workspace in replay order', () => {
		const at = (id: string, ts: string, ws = 7): StudyEvent => ({ id, workspaceId: ws, device: 'web', ts, type: 'grammar', payload: grammarPayload('p', 'a', 1, 1) });
		const runs = grammarRunsOf(7, [at('b', '2026-11-19T08:00:00Z'), at('a', '2026-11-19T08:00:00Z'), at('c', '2026-11-18T08:00:00Z'), at('d', '2026-11-17T08:00:00Z', 8)]);
		expect(runs.map((r) => r.id)).toEqual(['c', 'a', 'b']);
	});
});
