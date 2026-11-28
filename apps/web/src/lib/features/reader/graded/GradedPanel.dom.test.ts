import { testContext, updateWorkspaces } from '$lib/testing/context';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/api/library', () => ({ gradedCatalogue: vi.fn() }));

import { gradedCatalogue } from '$lib/api/library';
import type { Book, GradedText, Workspace } from '$lib/api/types';
import fixture from '../../../../../../../docs/contracts/graded/catalogue.json';
import GradedPanel from './GradedPanel.svelte';

const ZH = (fixture.answer.texts as GradedText[]).filter((t) => t.language === 'zh');

function open(props: { books?: Record<string, Book | null>; busy?: string | null; onread?: (t: GradedText) => void } = {}, settings: Record<string, unknown> = {}) {
	const ctx = testContext();
	const ws: Workspace = { id: 1, language: 'zh', name: '', settings, updatedAt: 't' };
	updateWorkspaces(ctx.session.workspaces, () => ({ list: [ws], current: ws }));
	const onread = props.onread ?? vi.fn();
	render(GradedPanel, {
		props: { language: 'zh', books: props.books ?? {}, busy: props.busy ?? null, onread },
		context: ctx.context
	});
	return { onread };
}

beforeEach(() => {
	vi.mocked(gradedCatalogue).mockResolvedValue(ZH);
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe('GradedPanel (#231)', () => {
	it('lists the texts of the workspace language with level, kind, length and the review state', async () => {
		open();
		const list = await screen.findByTestId('graded-texts');
		expect(gradedCatalogue).toHaveBeenCalledWith('zh');
		const items = within(list).getAllByRole('listitem').filter((li) => li.parentElement === list);
		expect(items).toHaveLength(ZH.length);
		const first = items[0];
		expect(first.textContent).toContain(ZH[0].title);
		expect(first.textContent).toContain(ZH[0].levelName);
		expect(first.textContent).toContain(`${ZH[0].length} characters`);
		expect(first.textContent).toContain('Reviewed by agents');
		expect(within(first).getByRole('button', { name: 'Read' })).toBeTruthy();
	});

	it('filters by level', async () => {
		open();
		await screen.findByTestId('graded-texts');
		const select = screen.getByLabelText('Level') as HTMLSelectElement;
		const levels = [...new Set(ZH.map((t) => t.level))];
		expect([...select.options].map((o) => o.textContent)).toEqual([
			'All levels',
			...levels.map((l) => ZH.find((t) => t.level === l)!.levelName)
		]);
		await fireEvent.change(select, { target: { value: String(levels[1]) } });
		const list = screen.getByTestId('graded-texts');
		const titles = within(list)
			.getAllByRole('listitem')
			.filter((li) => li.parentElement === list)
			.map((li) => li.querySelector('strong')?.textContent);
		expect(titles).toEqual(ZH.filter((t) => t.level === levels[1]).map((t) => t.title));
	});

	it('shows the new words with their readings, and hides pinyin when the workspace hides it', async () => {
		const withGloss = ZH.find((t) => t.glosses.length > 0)!;
		const g = withGloss.glosses[0];
		open();
		await screen.findByTestId('graded-texts');
		expect(screen.getByText(g.word)).toBeTruthy();
		expect(document.body.textContent).toContain(g.reading);
		expect(document.body.textContent).toContain(g.meaning);
		cleanup();
		open({}, { romanisation: { pinyin: 'never' } });
		await screen.findByTestId('graded-texts');
		expect(screen.getByText(g.word)).toBeTruthy();
		expect(document.body.textContent).not.toContain(g.reading);
		expect(document.body.textContent).toContain(g.meaning);
	});

	it('reads a text, and offers Open for one in the library', async () => {
		const onread = vi.fn();
		const book = { id: 7 } as Book;
		open({ onread, books: { [ZH[1].id]: book } });
		const list = await screen.findByTestId('graded-texts');
		await fireEvent.click(within(list).getAllByRole('button', { name: 'Read' })[0]);
		expect(onread).toHaveBeenCalledWith(ZH[0]);
		const link = within(list).getByRole('link', { name: 'Open it' }) as HTMLAnchorElement;
		expect(link.getAttribute('href')).toBe('/reader/book/7/0');
	});

	it('disables Read while a text is added and says which', async () => {
		open({ busy: ZH[0].id });
		const list = await screen.findByTestId('graded-texts');
		const buttons = within(list).getAllByRole('button') as HTMLButtonElement[];
		expect(buttons.every((b) => b.disabled)).toBe(true);
		expect(buttons[0].textContent).toContain('Adding');
	});
});
