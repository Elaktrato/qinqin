import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testContext, type TestContext } from '$lib/testing/context';

vi.mock('$lib/api/starter', () => ({ starterSets: vi.fn(), starterSet: vi.fn() }));
vi.mock('$lib/api/courses', async (importOriginal) => ({ ...(await importOriginal<typeof import('$lib/api/courses')>()), courses: vi.fn(), course: vi.fn() }));
vi.mock('$lib/studycore/data', async (importOriginal) => ({ ...(await importOriginal<typeof import('$lib/studycore/data')>()), loadStudyHistory: vi.fn() }));
vi.mock('$lib/features/flashcards/decks/starterSet', () => ({
	addStarterSet: vi.fn(),
	starterSetTarget: (s: { language: string; name: string }) => ({ id: `d-starter-${s.language}`, name: s.name })
}));

import { starterSets } from '$lib/api/starter';
import { course, courses } from '$lib/api/courses';
import { loadStudyHistory } from '$lib/studycore/data';
import { testCourse } from '$lib/features/courses/testing/course';
import { history } from '$lib/testing/study';
import * as build from '$lib/testing/study';
import StartOffer from './StartOffer.svelte';

let ctx: TestContext;
const info = { id: 'zh-test', name: 'Test course', version: '1', language: 'zh', license: 'CC-BY-4.0', attribution: 'tests', notice: '', title: { en: 'Test course' } };

beforeEach(() => {
	vi.clearAllMocks();
	localStorage.clear();
	ctx = testContext();
	ctx.session.workspaces.set({
		list: [{ id: 1, language: 'zh', name: 'zh', settings: {} } as never],
		current: { id: 1, language: 'zh', name: 'zh', settings: {} } as never
	});
	ctx.session.features.set({ list: [{ id: 'courses', enabled: true }], status: 'ready' });
	vi.mocked(starterSets).mockResolvedValue([
		{ id: 'starter-zh', language: 'zh', name: 'Starter words (Chinese)', license: 'CC0-1.0', attribution: 'x', wordCount: 55, humanReviewed: false }
	]);
	vi.mocked(courses).mockResolvedValue([info]);
	vi.mocked(course).mockResolvedValue(testCourse());
	vi.mocked(loadStudyHistory).mockResolvedValue(history());
});
afterEach(() => cleanup());

describe('the course start card on Home (#225)', () => {
	it('offers the two ways in: the course with Starter mode, or finding your place', async () => {
		const settle = vi.fn();
		render(StartOffer, { props: { onsettle: settle }, context: ctx.context });
		const offer = await screen.findByTestId('course-start-offer');
		expect(screen.getByRole('heading', { level: 2, name: 'How would you like to start?' })).toBeTruthy();
		expect(screen.getByRole('heading', { level: 3, name: "I'm new to Chinese" })).toBeTruthy();
		expect(screen.getByRole('link', { name: 'Start the course' }).getAttribute('href')).toBe('/courses/play/zh-test/sounds/listening');
		await screen.findByRole('button', { name: 'Also add the Starter words' });
		expect(screen.getByRole('link', { name: 'Find your place' }).getAttribute('href')).toBe('/courses/play/zh-test/section/level-1/placement');
		expect(screen.getByRole('link', { name: 'Tell us which levels you know' }).getAttribute('href')).toBe('/settings?tab=study#known');
		// First "deciding" (the older offers wait), then the answer.
		expect(settle.mock.calls[0][0]).toBeNull();
		expect(settle).toHaveBeenLastCalledWith(true);
		await fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
		expect(offer.isConnected).toBe(false);
		expect(localStorage.getItem('qinqin.courseStart.dismissed.1')).toBe('1');
	});

	it('is not shown once the workspace has a card, but still stands in for the other offers', async () => {
		vi.mocked(loadStudyHistory).mockResolvedValue(history({ cards: [build.card({ id: 'c1', entryId: 1, createdAt: 't' })] }));
		const settle = vi.fn();
		render(StartOffer, { props: { onsettle: settle }, context: ctx.context });
		await waitFor(() => expect(settle).toHaveBeenCalledWith(true));
		expect(screen.queryByTestId('course-start-offer')).toBeNull();
	});

	it('without a course for the language, or with Courses off, it leaves the older offers to Home', async () => {
		vi.mocked(courses).mockResolvedValue([]);
		const settle = vi.fn();
		render(StartOffer, { props: { onsettle: settle }, context: ctx.context });
		await waitFor(() => expect(settle).toHaveBeenCalledWith(false));
		expect(screen.queryByTestId('course-start-offer')).toBeNull();
		cleanup();
		ctx.session.features.set({ list: [{ id: 'courses', enabled: false }], status: 'ready' });
		const off = vi.fn();
		render(StartOffer, { props: { onsettle: off }, context: ctx.context });
		await waitFor(() => expect(off).toHaveBeenCalledWith(false));
	});
});
