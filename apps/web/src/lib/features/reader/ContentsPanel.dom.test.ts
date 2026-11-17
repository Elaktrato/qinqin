import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ContentsPanel from './ContentsPanel.svelte';

afterEach(cleanup);

function mount(props: { titles: string[]; current: number; onjump?: () => void }) {
	render(ContentsPanel, {
		titles: props.titles,
		current: props.current,
		hrefOf: (n: number) => `/reader/7/${n}`,
		lang: 'zh-Hans',
		onjump: props.onjump
	} as never);
}

describe('ContentsPanel', () => {
	it('lists every chapter as a link in order', () => {
		mount({ titles: ['故乡', '社戏', ''], current: 0 });
		const nav = screen.getByRole('navigation', { name: 'Contents' });
		const links = within(nav).getAllByRole('link');
		expect(links.map((a) => a.getAttribute('href'))).toEqual(['/reader/7/0', '/reader/7/1', '/reader/7/2']);
		expect(links[1].textContent).toContain('社戏');
		// An untitled chapter is named by its number.
		expect(links[2].textContent).toContain('Chapter 3');
	});

	it('the current chapter has aria-current page and the "(reading now)" name', () => {
		mount({ titles: ['故乡', '社戏'], current: 1 });
		const current = screen.getByRole('link', { name: '社戏 (reading now)' });
		expect(current.getAttribute('aria-current')).toBe('page');
		expect(screen.getByRole('link', { name: '故乡' }).getAttribute('aria-current')).toBeNull();
	});

	it('chapter titles carry the book lang', () => {
		mount({ titles: ['故乡', ''], current: 0 });
		const [titled, untitled] = screen.getAllByRole('link');
		expect(titled.querySelector('[lang]')?.getAttribute('lang')).toBe('zh-Hans');
		// Interface text (the numbered fallback) carries no lang.
		expect(untitled.querySelector('[lang]')).toBeNull();
	});

	it('activating a link calls onjump (the sheet closes)', async () => {
		const onjump = vi.fn();
		mount({ titles: ['故乡', '社戏'], current: 0, onjump });
		const link = screen.getByRole('link', { name: '社戏' });
		link.addEventListener('click', (e) => e.preventDefault());
		await fireEvent.click(link);
		expect(onjump).toHaveBeenCalledTimes(1);
	});

	it('a one-chapter book shows its title only', () => {
		mount({ titles: ['故乡'], current: 0 });
		expect(screen.getAllByRole('link')).toHaveLength(1);
		expect(screen.getByRole('link', { name: '故乡 (reading now)' })).toBeTruthy();
	});

	it('chapters not seen yet are named by their number', () => {
		mount({ titles: ['故乡', undefined as unknown as string, '社戏'], current: 0 });
		expect(screen.getByRole('link', { name: 'Chapter 2' })).toBeTruthy();
	});
});
