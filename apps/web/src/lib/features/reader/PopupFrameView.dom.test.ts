import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PopupFrameView from './PopupFrameView.svelte';
import source from './PopupFrameView.svelte?raw';
import type { PopupFrame } from './popupStackCore';
import type { LookupController, StackInfo } from './useLookup.svelte';

afterEach(cleanup);
beforeEach(() => {
	vi.stubGlobal(
		'ResizeObserver',
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		}
	);
});
afterEach(() => vi.unstubAllGlobals());

const style = source.slice(source.indexOf('<style>'));

function mount(depth = 1) {
	const closeFrame = vi.fn();
	const lookup = {
		popups: { shiftHeld: false, enter() {}, leave() {}, move() {} },
		hold() {},
		closeFrame
	} as unknown as LookupController;
	const frame: PopupFrame = { id: 3, depth, anchor: { x: 10, y: 10, w: 20, h: 20 }, text: '你好', offset: 0, results: [] };
	const info = { mode: 'hover', lang: 'zh', textLang: 'zh-Hans', note: '', paragraph: '' } as unknown as StackInfo;
	render(PopupFrameView, { frame, info, lookup, studyWorkspaceId: null });
	return { closeFrame };
}

describe('PopupFrameView (#102)', () => {
	it('the close control is an IconButton named Close with a tooltip', async () => {
		const { closeFrame } = mount();
		const close = screen.getByRole('button', { name: 'Close' });
		expect(close.classList.contains('icon-button')).toBe(true);
		expect(close.parentElement?.querySelector('[role="tooltip"]')?.textContent).toBe('Close');
		await fireEvent.click(close);
		expect(closeFrame).toHaveBeenCalledWith(3);
	});

	it('is a dialog named by the looked-up text', () => {
		mount();
		expect(screen.getByRole('dialog', { name: 'Dictionary: 你好' })).toBeTruthy();
	});

	it('sits on --panel with a --hair outline, --shadow-float and --radius-large; no Canvas, no literal colours', () => {
		const popup = style.slice(style.indexOf('.popup {'), style.indexOf('}', style.indexOf('.popup {')));
		expect(popup).toMatch(/background:\s*var\(--panel\)/);
		expect(popup).toMatch(/border:\s*1px solid var\(--hair\)/);
		expect(popup).toMatch(/box-shadow:\s*var\(--shadow-float\)/);
		expect(popup).toMatch(/border-radius:\s*var\(--radius-large\)/);
		expect(popup).toMatch(/width:\s*18\.75rem/);
		expect(style).not.toMatch(/\bCanvas\b(?!Text)/);
		expect(style).not.toMatch(/currentColor \d+%/);
	});

	it('marks nested popups by depth with an --accent start line (a shape), not by colours', () => {
		expect(style).toMatch(/\.popup:not\(\.depth-1\)\s*\{[^}]*border-inline-start:\s*3px solid var\(--accent\)/);
		expect(style).not.toMatch(/--warn/);
	});

	it('fades in with --motion-fast', () => {
		expect(style).toMatch(/animation:[^;]*var\(--motion-fast\)/);
	});
});
