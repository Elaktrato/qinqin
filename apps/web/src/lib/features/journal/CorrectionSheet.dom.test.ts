import { testContext, type TestContext } from '$lib/testing/context';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';
import type { Correction } from './corrections';
import type { AiGate } from './editorLogic';
import CorrectionSheet from './CorrectionSheet.svelte';
import source from './CorrectionSheet.svelte?raw';

let ctx: TestContext = testContext();
beforeEach(() => {
	ctx = testContext();
});

function correction(id: string, kind: 'mistake' | 'suggestion', index: number): Correction {
	return {
		annotation: {
			id,
			quote: id,
			prefix: '',
			suffix: '',
			correction: `${id}fixed`,
			explanation: `${id} why`,
			category: 'grammar',
			kind
		},
		kind,
		state: 'placed',
		index
	};
}

const list = [correction('a', 'mistake', 0), correction('b', 'suggestion', 1), correction('c', 'mistake', 2)];
const gate: AiGate = { enabled: true, hint: null, settingsLink: false };
const props = { corrections: list, studyLang: 'zh-Hans', explanationLang: 'en', onclose: vi.fn(), onopen: vi.fn() };

afterEach(cleanup);

describe('CorrectionSheet (#103)', () => {
	it('is the shared lib/ui Sheet', () => {
		expect(source).toContain("from '$lib/ui/Sheet.svelte'");
	});

	it('is a dialog named "Correction 2 of 3" holding the expanded note', () => {
		render(CorrectionSheet, { props: { ...props, mode: 'corrections', openId: 'b', ...{ workspaceId: 1, gate, onstart: vi.fn() } }, context: ctx.context });
		const dialog = screen.getByRole('dialog', { name: 'Correction 2 of 3' });
		expect(dialog.textContent).toContain('bfixed');
		expect(dialog.textContent).toContain('b why');
		expect(dialog.querySelector('[aria-expanded="true"]')).toBeTruthy();
	});

	it('pages with onnext/onprev and the arrow keys, updating the name', async () => {
		const onopen = vi.fn();
		render(CorrectionSheet, { props: { ...props, onopen, mode: 'corrections', openId: 'a', ...{ workspaceId: 1, gate, onstart: vi.fn() } }, context: ctx.context });
		const dialog = screen.getByRole('dialog', { name: 'Correction 1 of 3' });
		await fireEvent.keyDown(dialog, { key: 'ArrowRight' });
		expect(onopen).toHaveBeenCalledWith('b');
		await fireEvent.keyDown(dialog, { key: 'ArrowLeft' });
		expect(onopen).toHaveBeenCalledTimes(1);
	});

	it('at the last correction next does nothing', async () => {
		const onopen = vi.fn();
		render(CorrectionSheet, { props: { ...props, onopen, mode: 'corrections', openId: 'c', ...{ workspaceId: 1, gate, onstart: vi.fn() } }, context: ctx.context });
		await fireEvent.keyDown(screen.getByRole('dialog'), { key: 'ArrowRight' });
		expect(onopen).not.toHaveBeenCalled();
	});

	it('Escape closes the sheet and returns focus to the mark of the shown correction', async () => {
		const mark = document.createElement('button');
		mark.id = 'mark-b';
		document.body.append(mark);
		const onclose = vi.fn();
		render(CorrectionSheet, { props: { ...props, onclose, mode: 'corrections', openId: 'b', ...{ workspaceId: 1, gate, onstart: vi.fn() } }, context: ctx.context });
		await fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
		expect(onclose).toHaveBeenCalled();
		expect(document.activeElement).toBe(mark);
	});

	it('the ideas variant is a dialog named "Ideas for today"', () => {
		render(CorrectionSheet, { props: { ...props, mode: 'ideas', openId: null, workspaceId: 1, gate, onstart: vi.fn() }, context: ctx.context });
		expect(screen.getByRole('dialog', { name: 'Ideas for today' })).toBeTruthy();
	});
});
