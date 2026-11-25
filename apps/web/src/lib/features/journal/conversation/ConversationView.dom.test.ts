import { StudyDays } from '$lib/time/studyDays';
import { studyDay as studyDayOf } from '$lib/time/studyDay';
import { testContext, type TestContext } from '$lib/testing/context';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '$lib/api/client';
import type { Conversation } from './types';

vi.mock('$app/navigation', () => ({ goto: vi.fn(async () => {}) }));
vi.mock('./conversations', async (importOriginal) => ({
	...(await importOriginal<typeof import('./conversations')>()),
	getConversation: vi.fn(),
	sendTurn: vi.fn(),
	saveConversation: vi.fn(),
	discardConversation: vi.fn(async () => {})
}));
vi.mock('../store', () => ({
	getJournalSettings: vi.fn(async () => ({ guidance: '', explanationLanguage: 'de' })),
	recordJournalEvent: vi.fn(async () => {})
}));
vi.mock('../journalEntries.svelte', () => ({ journalEntriesFor: vi.fn(() => ({ upsert: vi.fn() })) }));
vi.mock('../providerNames', () => ({ loadProviderNames: vi.fn(async () => new Map([['anthropic', 'Anthropic']])) }));
vi.mock('$lib/features/reader/useLookup.svelte', () => ({
	LookupController: class {
		attach(): () => void {
			return () => {};
		}
		close(): void {}
		listen(): () => void {
			return () => {};
		}
	}
}));
vi.mock('$lib/features/reader/PopupStackView.svelte', async () => ({ default: (await import('./EmptyStub.test.svelte')).default }));

import { goto } from '$app/navigation';
import { primaryActions } from '$lib/ui/testing/primary';
import { recordJournalEvent } from '../store';
import { discardConversation, getConversation, saveConversation, sendTurn } from './conversations';
import ConversationView from './ConversationView.svelte';

const SHARED_DAY = studyDayOf([]);
let ctx: TestContext = testContext();
beforeEach(() => {
	ctx = testContext();
	vi.spyOn(StudyDays.prototype, 'day').mockImplementation((() => SHARED_DAY) as never);
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

const empty: Conversation = { id: 'c1', topic: '周末', level: 'elementary', createdAt: '', updatedAt: '', messages: [] };
const talked: Conversation = {
	...empty,
	messages: [
		{ seq: 1, role: 'partner', text: '你好！你周末做什么了？', annotations: [], model: 'claude-x', provider: 'anthropic', turnId: 'o', createdAt: '' },
		{
			seq: 2,
			role: 'learner',
			text: '我是很好。',
			annotations: [{ id: 'm2a1', quote: '是很', prefix: '我', suffix: '好。', correction: '很', explanation: 'Kein 是.', category: 'grammar', kind: 'mistake' }],
			turnId: 't2',
			createdAt: ''
		},
		{ seq: 3, role: 'partner', text: '太好了。', annotations: [], model: 'claude-x', provider: 'anthropic', turnId: 't2', createdAt: '' }
	]
};

function show(props: Partial<{ aiAvailable: boolean | null; aiBanner: string | null }> = {}) {
	return render(ConversationView, {
		props: { workspaceId: 3, id: 'c1', studyLang: 'zh-Hans', aiAvailable: true, aiBanner: null, ...props },
		context: ctx.context
	});
}

describe('ConversationView', () => {
	it('lets the partner open an empty conversation', async () => {
		vi.mocked(getConversation).mockResolvedValue(empty);
		vi.mocked(sendTurn).mockResolvedValue(talked);
		show();
		const begin = await screen.findByRole('button', { name: 'Let the partner begin' });
		expect(primaryActions(document.body)).toEqual([begin]);
		await fireEvent.click(begin);
		expect(sendTurn).toHaveBeenCalledWith(3, 'c1', '', expect.any(String), expect.any(AbortSignal));
		expect(await screen.findByText('太好了。')).toBeTruthy();
	});

	it('shows the replies as lookup text, the learner corrections in the margin, and who answered', async () => {
		vi.mocked(getConversation).mockResolvedValue(talked);
		show();
		const reply = await screen.findByText('你好！你周末做什么了？');
		expect(reply.closest('[data-p]')?.getAttribute('data-p')).toBe('0');
		expect(reply.closest('p')?.getAttribute('lang')).toBe('zh-Hans');
		// The learner's mark and its note in the journal's margin.
		const mark = document.getElementById('mark-m2a1');
		expect(mark?.textContent).toContain('是很');
		expect(screen.getByRole('complementary').textContent).toContain('是很');
		await waitFor(() => expect(screen.getByText(/claude-x/).textContent).toContain('Anthropic'));
		await fireEvent.click(mark!);
		await waitFor(() => expect(screen.getByText('Kein 是.')).toBeTruthy());
	});

	it('sends a message and keeps it in the composer when the turn fails', async () => {
		vi.mocked(getConversation).mockResolvedValue(talked);
		vi.mocked(sendTurn).mockRejectedValue(new ApiError(429, JSON.stringify({ error: 'rate_limited', message: 'x' }), 60));
		show();
		const box = await screen.findByRole('textbox', { name: 'Your message' });
		const send = screen.getByRole('button', { name: 'Send' });
		expect((send as HTMLButtonElement).disabled).toBe(true);
		await fireEvent.input(box, { target: { value: '我去了公园。' } });
		expect((send as HTMLButtonElement).disabled).toBe(false);
		await fireEvent.click(send);
		expect(sendTurn).toHaveBeenCalledWith(3, 'c1', '我去了公园。', expect.any(String), expect.any(AbortSignal));
		expect((await screen.findByRole('alert')).textContent).toMatch(/all AI calls for this hour/);
		expect((box as HTMLTextAreaElement).value).toBe('我去了公园。');
	});

	it('Ctrl+Enter during an IME composition does not send; after it, it does', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		try {
			vi.mocked(getConversation).mockResolvedValue(talked);
			vi.mocked(sendTurn).mockResolvedValue({ conversation: talked } as never);
			show();
			const box = await screen.findByRole('textbox', { name: 'Your message' });
			await fireEvent.compositionStart(box);
			await fireEvent.compositionUpdate(box, { data: 'ni' });
			await fireEvent.input(box, { target: { value: '你好' } });
			await fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true, isComposing: true });
			await fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true, keyCode: 229 });
			expect(sendTurn).not.toHaveBeenCalled();
			await fireEvent.compositionEnd(box, { data: '你好' });
			vi.advanceTimersByTime(100);
			await fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true });
			expect(sendTurn).toHaveBeenCalledTimes(1);
		} finally {
			vi.useRealTimers();
		}
	});

	it('keeps the focus in the message field through a turn and reads the reply out', async () => {
		vi.mocked(getConversation).mockResolvedValue(talked);
		const answered: Conversation = {
			...talked,
			messages: [
				...talked.messages,
				{ seq: 4, role: 'learner', text: '我去了。', annotations: [], turnId: 'x', createdAt: '' },
				{ seq: 5, role: 'partner', text: '去哪儿了？', annotations: [], model: 'claude-x', provider: 'anthropic', turnId: 'x', createdAt: '' }
			]
		};
		let resolve!: (c: Conversation) => void;
		vi.mocked(sendTurn).mockImplementation(() => new Promise((r) => (resolve = r)));
		show();
		const box = (await screen.findByRole('textbox', { name: 'Your message' })) as HTMLTextAreaElement;
		box.focus();
		await fireEvent.input(box, { target: { value: '我去了。' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Send' }));
		// Busy: the field is read-only, not disabled, so it keeps the focus (and the phone keyboard).
		expect(box.disabled).toBe(false);
		expect(box.readOnly).toBe(true);
		box.focus();
		resolve(answered);
		await screen.findByText('去哪儿了？');
		await waitFor(() => expect(box.readOnly).toBe(false));
		expect(document.activeElement).toBe(box);
		expect(box.value).toBe('');
		expect(document.querySelector('.live')?.textContent).toBe('Partner: 去哪儿了？');
	});

	it('words a refused message for the conversation', async () => {
		vi.mocked(getConversation).mockResolvedValue(talked);
		vi.mocked(sendTurn).mockRejectedValue(new ApiError(413, JSON.stringify({ error: 'too_long', message: 'x' })));
		show();
		await fireEvent.input(await screen.findByRole('textbox', { name: 'Your message' }), { target: { value: '好' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Send' }));
		expect((await screen.findByRole('alert')).textContent).toContain('A message has at most 1,000 characters.');
	});

	it('says why it cannot send without a key and links the AI settings', async () => {
		vi.mocked(getConversation).mockResolvedValue(talked);
		show({ aiAvailable: false, aiBanner: 'Add your AI key first.' });
		expect(await screen.findByText(/Add your AI key first\./)).toBeTruthy();
		expect(screen.getByRole('link', { name: 'Open Settings → AI' }).getAttribute('href')).toBe('/settings?tab=ai');
	});

	it('saves the conversation as an entry and opens it', async () => {
		vi.mocked(getConversation).mockResolvedValue(talked);
		vi.mocked(saveConversation).mockResolvedValue({ id: 'E1', date: '2026-11-24', title: '周末', text: 'x', source: 'typed', createdAt: '', updatedAt: '' });
		show();
		await fireEvent.click(await screen.findByRole('button', { name: 'Save as journal entry' }));
		await waitFor(() => expect(goto).toHaveBeenCalledWith('/journal/e/E1'));
		expect(vi.mocked(saveConversation).mock.calls[0].slice(0, 2)).toEqual([3, 'c1']);
		expect(recordJournalEvent).toHaveBeenCalled();
	});

	it('discards after a confirmation', async () => {
		vi.mocked(getConversation).mockResolvedValue(talked);
		show();
		await fireEvent.click(await screen.findByRole('button', { name: 'Discard' }));
		expect(discardConversation).not.toHaveBeenCalled();
		await waitFor(() => expect(document.activeElement?.textContent).toContain('Keep it'));
		await fireEvent.click(screen.getByRole('button', { name: 'Discard it' }));
		expect(discardConversation).toHaveBeenCalledWith(3, 'c1');
		await waitFor(() => expect(goto).toHaveBeenCalledWith('/journal/talk'));
	});

	it('says so when the conversation is gone', async () => {
		vi.mocked(getConversation).mockResolvedValue(null);
		show();
		expect(await screen.findByText('This conversation was saved or discarded.')).toBeTruthy();
	});
});
