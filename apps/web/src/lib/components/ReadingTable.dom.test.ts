import { cleanup, render, screen, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import ReadingTable from './ReadingTable.svelte';

afterEach(cleanup);

const r = (type: string, value: string) => ({ type, value });

describe('ReadingTable', () => {
	it('one row per reading kind, the label once, the values separated by " | "', () => {
		render(ReadingTable, {
			readings: [r('pinyin', 'xīn'), r('pinyin', 'xìn'), r('bopomofo', 'ㄒㄧㄣ')],
			language: 'zh',
			label: 'Readings'
		});
		const table = screen.getByRole('table', { name: 'Readings' });
		const rows = within(table).getAllByRole('row');
		expect(rows).toHaveLength(2);
		expect(within(rows[0]).getByRole('rowheader').textContent).toBe('Pinyin');
		expect(within(rows[0]).getByRole('cell').textContent?.replace(/\s+/g, ' ').trim()).toBe('xīn | xìn');
		expect(within(rows[1]).getByRole('rowheader').textContent).toBe('Bopomofo');
		expect(table.textContent).not.toContain('Pinyin:');
		expect(table.textContent?.match(/Pinyin/g)).toHaveLength(1);
	});

	it('Japanese on and kun readings: several of each, in order of first appearance', () => {
		render(ReadingTable, {
			readings: [r('on', 'カ'), r('kun', 'した'), r('on', 'ゲ'), r('kun', 'さ.げる')],
			language: 'ja',
			label: 'Readings'
		});
		const rows = screen.getAllByRole('row');
		expect(rows.map((row) => within(row).getByRole('rowheader').textContent)).toEqual(['On', 'Kun']);
		expect(rows.map((row) => within(row).getByRole('cell').textContent?.replace(/\s+/g, ' ').trim())).toEqual([
			'カ | ゲ',
			'した | さ.げる'
		]);
	});

	it('every value carries its own language, the separator is hidden from screen readers', () => {
		const { container } = render(ReadingTable, {
			readings: [r('pinyin', 'xīn'), r('pinyin', 'xìn')],
			language: 'zh',
			label: 'Readings'
		});
		expect([...container.querySelectorAll('td [lang]')].map((el) => el.getAttribute('lang'))).toEqual([
			'zh-Latn-pinyin',
			'zh-Latn-pinyin'
		]);
		expect(container.querySelectorAll('td [aria-hidden="true"]')).toHaveLength(1);
	});

	it('a single reading has no separator', () => {
		const { container } = render(ReadingTable, {
			readings: [r('pinyin', 'hǎo')],
			language: 'zh',
			label: 'Readings'
		});
		expect(screen.getByRole('cell').textContent?.trim()).toBe('hǎo');
		expect(container.textContent).not.toContain('|');
	});

	it('a pack-defined type without a label shows its values alone', () => {
		render(ReadingTable, { readings: [r('jyutping', 'hou2')], language: 'zh', label: 'Readings' });
		expect(screen.queryByRole('rowheader')).toBeNull();
		expect(screen.getByRole('cell').textContent?.trim()).toBe('hou2');
	});

	it('renders nothing without readings', () => {
		const { container } = render(ReadingTable, { readings: [], language: 'zh', label: 'Readings' });
		expect(container.querySelector('table')).toBeNull();
	});

	it('emphasis wraps each value in <strong>', () => {
		const { container } = render(ReadingTable, {
			readings: [r('pinyin', 'xīn'), r('pinyin', 'xìn')],
			language: 'zh',
			label: 'Readings',
			emphasis: true
		});
		expect([...container.querySelectorAll('td strong')].map((el) => el.textContent)).toEqual(['xīn', 'xìn']);
	});
});
