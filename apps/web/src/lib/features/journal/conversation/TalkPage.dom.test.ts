import { testContext, type TestContext } from '$lib/testing/context';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/navigation', () => ({ goto: vi.fn(async () => {}) }));
vi.mock('./conversations', async (importOriginal) => ({
	...(await importOriginal<typeof import('./conversations')>()),
	listConversations: vi.fn(),
	startConversation: vi.fn()
}));
vi.mock('../IdeasPanel.svelte', async () => ({ default: (await import('./EmptyStub.test.svelte')).default }));

import { goto } from '$app/navigation';
import { primaryActions } from '$lib/ui/testing/primary';
import { listConversations, startConversation } from './conversations';
import TalkPage from './TalkPage.svelte';

let ctx: TestContext = testContext();
beforeEach(() => {
	ctx = testContext();
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

const gate = { enabled: true, hint: null, settingsLink: false };

describe('TalkPage', () => {
	it('starts a conversation with a topic and the level of the latest one', async () => {
		vi.mocked(listConversations).mockResolvedValue([
			{ id: 'c1', topic: '周末', level: 'intermediate', messageCount: 3, createdAt: '', updatedAt: '2026-11-24T08:00:00Z' }
		]);
		vi.mocked(startConversation).mockResolvedValue({ id: 'c2', topic: '学校', level: 'intermediate', createdAt: '', updatedAt: '', messages: [] });
		render(TalkPage, { props: { workspaceId: 3, gate, studyLang: 'zh-Hans' }, context: ctx.context });
		const open = await screen.findByRole('link', { name: /周末/ });
		expect(open.getAttribute('href')).toBe('/journal/talk/c1');
		expect(open.textContent).toContain('3 messages');
		await waitFor(() => expect((screen.getByRole('combobox', { name: 'Your level' }) as HTMLSelectElement).value).toBe('intermediate'));
		expect(screen.getByText(/last 12 messages/)).toBeTruthy();
		await fireEvent.input(screen.getByRole('textbox', { name: 'Topic (optional)' }), { target: { value: ' 学校 ' } });
		const start = screen.getByRole('button', { name: 'Start' });
		expect(primaryActions(document.body)).toEqual([start]);
		await fireEvent.click(start);
		expect(startConversation).toHaveBeenCalledWith(3, '学校', 'intermediate');
		await waitFor(() => expect(goto).toHaveBeenCalledWith('/journal/talk/c2'));
	});

	it('keeps a level the learner picked before the list loaded', async () => {
		let resolve!: (l: never[]) => void;
		vi.mocked(listConversations).mockImplementation(() => new Promise((r) => (resolve = r as never)));
		render(TalkPage, { props: { workspaceId: 3, gate, studyLang: 'zh-Hans' }, context: ctx.context });
		const select = screen.getByRole('combobox', { name: 'Your level' }) as HTMLSelectElement;
		await fireEvent.change(select, { target: { value: 'advanced' } });
		resolve([{ id: 'c1', topic: '', level: 'elementary', messageCount: 1, createdAt: '', updatedAt: '2026-11-24' }] as never);
		await screen.findByRole('link', { name: /without a topic/ });
		expect(select.value).toBe('advanced');
	});

	it('shows a refused start by its error code', async () => {
		vi.mocked(listConversations).mockResolvedValue([]);
		const { ApiError } = await import('$lib/api/client');
		vi.mocked(startConversation).mockRejectedValue(new ApiError(409, JSON.stringify({ error: 'conversation_limit', message: 'x' })));
		render(TalkPage, { props: { workspaceId: 3, gate, studyLang: 'zh-Hans' }, context: ctx.context });
		expect(await screen.findByText('No open conversations.')).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: 'Start' }));
		expect((await screen.findByRole('alert')).textContent).toContain('You have 20 open conversations.');
	});
});
