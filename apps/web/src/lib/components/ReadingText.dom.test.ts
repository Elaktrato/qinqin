import { testContext, updateWorkspaces } from '$lib/testing/context';
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import type { Workspace } from '$lib/api/types';

import ReadingText from './ReadingText.svelte';

function open(props: { type: string; value: string; language: string }, settings: Record<string, unknown> = {}) {
	const ctx = testContext();
	const ws: Workspace = { id: 4, language: props.language, name: '', settings, updatedAt: 't' };
	updateWorkspaces(ctx.session.workspaces, () => ({ list: [ws], current: ws }));
	return render(ReadingText, { props, context: ctx.context });
}

afterEach(cleanup);

describe('ReadingText respects hidden romanisation (#284)', () => {
	it('shows a reading with its label by default', () => {
		const { container } = open({ type: 'pinyin', value: 'xué', language: 'zh' });
		expect(container.textContent).toContain('xué');
	});

	it('renders nothing for a hidden type', () => {
		const { container } = open({ type: 'pinyin', value: 'xué', language: 'zh' }, { romanisation: { pinyin: 'never' } });
		expect(container.textContent?.trim()).toBe('');
	});

	it('keeps another type of the same language', () => {
		const { container } = open({ type: 'bopomofo', value: 'ㄒㄩㄝˊ', language: 'zh' }, { romanisation: { pinyin: 'never' } });
		expect(container.textContent).toContain('ㄒㄩㄝˊ');
	});

	it('never hides kana', () => {
		const { container } = open({ type: 'kana', value: 'ねこ', language: 'ja' }, { romanisation: { romaji: 'never' } });
		expect(container.textContent).toContain('ねこ');
	});

	it('`reveal` shows a hidden reading (a hint the learner asked for)', () => {
		const ctx = testContext();
		const ws: Workspace = { id: 4, language: 'ja', name: '', settings: { romanisation: { romaji: 'never' } }, updatedAt: 't' };
		updateWorkspaces(ctx.session.workspaces, () => ({ list: [ws], current: ws }));
		const { container } = render(ReadingText, { props: { type: 'romaji', value: 'neko', language: 'ja', reveal: true }, context: ctx.context });
		expect(container.textContent).toContain('neko');
	});
});
