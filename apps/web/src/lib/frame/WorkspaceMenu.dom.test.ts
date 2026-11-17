import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { workspaces } from '$lib/workspaces';
import WorkspaceMenu from './WorkspaceMenu.svelte';

const ws = (id: number, language: string, name = '') => ({ id, language, name, settings: {}, updatedAt: '' });

beforeEach(() => {
	localStorage.clear();
	workspaces.set({ list: [ws(1, 'zh'), ws(2, 'ja'), ws(3, 'zh', 'Novels')], current: ws(1, 'zh') });
});
afterEach(() => cleanup());

describe('WorkspaceMenu', () => {
	it('the trigger is the current workspace flag alone, named "Workspace: <label>", with a tooltip', () => {
		render(WorkspaceMenu);
		const trigger = screen.getByRole('button', { name: 'Workspace: Chinese' });
		expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
		expect(trigger.querySelector('svg.flag')).not.toBeNull();
		expect(trigger.textContent?.trim()).toBe('');
		expect(trigger.parentElement?.querySelector('[role="tooltip"]')?.textContent).toBe('Workspace: Chinese');
	});

	it('a named workspace is named with its name too', () => {
		workspaces.set({ list: [ws(1, 'zh'), ws(3, 'zh', 'Novels')], current: ws(3, 'zh', 'Novels') });
		render(WorkspaceMenu);
		expect(screen.getByRole('button', { name: 'Workspace: Chinese, Novels' })).toBeTruthy();
	});

	it('items are radio items with flag, language and name, the current one checked', async () => {
		render(WorkspaceMenu);
		await fireEvent.click(screen.getByRole('button', { name: /^Workspace:/ }));
		expect(screen.getByRole('menu', { name: 'Workspaces' })).toBeTruthy();
		const radios = screen.getAllByRole('menuitemradio');
		expect(radios.map((r) => r.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
			'Chinese',
			'Japanese',
			'Chinese Novels'
		]);
		expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false']);
		expect(radios[1].querySelector('svg.flag')).not.toBeNull();
		await waitFor(() => expect(document.activeElement).toBe(radios[0]));
	});

	it('picking one selects it and closes the menu', async () => {
		render(WorkspaceMenu);
		const trigger = screen.getByRole('button', { name: /^Workspace:/ });
		await fireEvent.click(trigger);
		await fireEvent.click(screen.getByRole('menuitemradio', { name: /Japanese/ }));
		expect(get(workspaces).current?.id).toBe(2);
		expect(screen.queryByRole('menu')).toBeNull();
		expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Workspace: Japanese' }));
	});

	it('"Manage workspaces" links to Settings → Workspaces', async () => {
		render(WorkspaceMenu);
		await fireEvent.click(screen.getByRole('button', { name: /^Workspace:/ }));
		const manage = screen.getByRole('menuitem', { name: 'Manage workspaces' });
		expect(manage.getAttribute('href')).toBe('/settings?tab=workspaces');
	});

	it('with no workspace the trigger reads "Workspace: none" and the menu holds only Manage workspaces', async () => {
		workspaces.set({ list: [], current: null });
		render(WorkspaceMenu);
		await fireEvent.click(screen.getByRole('button', { name: 'Workspace: none' }));
		expect(screen.queryAllByRole('menuitemradio')).toEqual([]);
		expect(screen.getAllByRole('menuitem').map((i) => i.textContent?.trim())).toEqual(['Manage workspaces']);
	});
});
