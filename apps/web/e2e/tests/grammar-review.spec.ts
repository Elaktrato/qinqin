// The spaced review of grammar points (#181) on a 360 px phone: a lesson finished at 80 % or more makes its point
// learned, the Grammar page shows it due with Review now, the round asks the lesson's own examples (fill the gap with
// the authored distractors), the finished point reaches the server as a `grammar` event of mode `review`, and the
// page then says when the next review is. The suite installs no grammar pack: the two grammar answers are a planted
// pack (page.route), the events are real.

import type { Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { PHONE, expectNoSidewaysScroll } from '../support/layout';
import { ulid } from '../support/api';

test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

const PACK = {
	packId: 'e2e-grammar',
	name: 'E2E grammar',
	version: '1',
	language: 'ja',
	license: 'CC BY 4.0',
	attribution: 'qinqin tests',
	notice: '',
	levels: [{ id: 'n5', name: 'N5', schemeLevels: [] }]
};
const EXAMPLES = [
	{ id: 'e1', text: '私は学生です。', reading: '', translation: 'I am a student.', focus: '学生', distractors: ['先生', '学校'], noOrder: true },
	{ id: 'e2', text: '田中さんは先生です。', reading: '', translation: 'Mr Tanaka is a teacher.', focus: '先生', distractors: ['学生', '医者'], noOrder: true },
	{ id: 'e3', text: 'これは本です。', reading: '', translation: 'This is a book.', focus: '本', distractors: ['水', '車'], noOrder: true }
];
const LESSON = { id: 'wa', level: 'n5', title: 'The topic particle は', summary: 'X は Y です', pattern: ['X は Y です'], body: ['は marks the topic.'], examples: EXAMPLES };

/** A lesson run of the point finished a day ago with 4 of 5: learned. */
async function learnPoint(learner: { api: { post: (path: string, body: unknown) => Promise<unknown> }; workspaces: { ja: number } }): Promise<void> {
	const at = Date.now() - 86_400_000;
	await learner.api.post('/api/events/batch', {
		events: [
			{
				id: ulid(at),
				workspaceId: learner.workspaces.ja,
				device: 'web',
				ts: new Date(at).toISOString(),
				type: 'grammar',
				payload: { point: 'e2e-grammar:wa', mode: 'lesson', score: 4, total: 5 }
			}
		]
	});
}

async function plantPack(page: Page): Promise<void> {
	await page.route(/\/api\/grammar(\?.*)?$/, (route) =>
		route.fulfill({ json: [{ ...PACK, lessons: [{ id: LESSON.id, level: 'n5', title: LESSON.title, summary: LESSON.summary, examples: 3 }] }] })
	);
	await page.route(/\/api\/grammar\/e2e-grammar\/wa$/, (route) => route.fulfill({ json: { pack: PACK, lesson: LESSON, prev: '', next: '' } }));
}

test('a learned grammar point comes back for review and its review is an event', async ({ page, learner }) => {
	await plantPack(page);
	await learnPoint(learner);

	await page.goto('/grammar');
	await expect(page.getByText('1 grammar point to review')).toBeVisible();
	await expect(page.getByText(/Due for review\s*·\s*learned/)).toBeVisible();
	await expectNoSidewaysScroll(page, '/grammar (a point due)');

	await page.getByRole('link', { name: 'Review now' }).tap();
	await expect(page).toHaveURL(/\/grammar\/review$/);
	await expect(page.getByRole('heading', { level: 1, name: 'Grammar review' })).toBeVisible();
	await expect(page.getByRole('heading', { level: 2, name: LESSON.title })).toBeVisible();
	await expect(page.getByText(/Point 1 of 1/)).toBeVisible();
	await expectNoSidewaysScroll(page, '/grammar/review');

	// Three clozes from the lesson's own examples, the authored distractors as choices.
	for (const [i, focus] of ['学生', '先生', '本'].entries()) {
		await expect(page.getByText(`Exercise ${i + 1} of 3`)).toBeVisible();
		await page.getByRole('button', { name: focus, exact: true }).tap();
		await page.getByRole('button', { name: i === 2 ? 'Finish' : 'Next' }).tap();
	}
	await expect(page.getByText('1 grammar point reviewed')).toBeVisible();
	await expectNoSidewaysScroll(page, '/grammar/review (done)');

	await expect
		.poll(async () =>
			(await learner.api.events(learner.workspaces.ja)).filter((e) => e.type === 'grammar').map((e) => e.payload as { mode: string; score: number; total: number })
		)
		.toEqual([
			{ point: 'e2e-grammar:wa', mode: 'lesson', score: 4, total: 5 },
			{ point: 'e2e-grammar:wa', mode: 'review', score: 3, total: 3 }
		]);

	// Reviewed: no longer due; the page says when it comes back, and the row when it was last reviewed.
	await page.getByRole('link', { name: 'Done' }).tap();
	await expect(page).toHaveURL(/\/grammar$/);
	await expect(page.getByText(/^Next review: /)).toBeVisible();
	await expect(page.getByText(/·\s*last reviewed/)).toBeVisible();
	await expect(page.getByRole('link', { name: 'Review now' })).toHaveCount(0);
});

test('a study session that includes grammar review runs the round after the cards', async ({ page, learner }) => {
	await plantPack(page);
	await learnPoint(learner);
	await page.goto('/');
	await page.getByRole('region', { name: 'Flashcards' }).getByRole('link', { name: 'Study' }).tap();
	const modal = page.getByRole('dialog', { name: 'Study' });
	// No card at all: only the grammar point is due once the setup includes it.
	const chip = modal.getByRole('checkbox', { name: 'Grammar review · 1' });
	await expect(chip).toBeEnabled();
	await chip.check();
	const start = modal.getByRole('button', { name: 'Start studying' });
	await expect(start).toBeEnabled();
	await expectNoSidewaysScroll(page, 'the study modal with grammar review');
	await start.tap();
	await expect(page).toHaveURL(/\/study\/session$/);
	await expect(page.getByRole('heading', { level: 1, name: 'Grammar review' })).toBeVisible();
	for (const [i, focus] of ['学生', '先生', '本'].entries()) {
		await page.getByRole('button', { name: focus, exact: true }).tap();
		await page.getByRole('button', { name: i === 2 ? 'Finish' : 'Next' }).tap();
	}
	await expect(page.getByText('Session complete')).toBeVisible();
	await expect(page.getByRole('list', { name: 'XP by card type' })).toContainText('Grammar +20');
	await expectNoSidewaysScroll(page, 'the session summary with grammar');
	await expect
		.poll(async () => (await learner.api.events(learner.workspaces.ja)).filter((e) => e.type === 'grammar' && (e.payload as { mode: string }).mode === 'review').length)
		.toBe(1);
});
