import { afterEach, describe, expect, it, vi } from 'vitest';
import { canShare, shareText } from './share';

const win = window as unknown as { Capacitor?: unknown };
const nav = navigator as unknown as { share?: unknown; clipboard?: unknown };

afterEach(() => {
	delete win.Capacitor;
	delete nav.share;
	delete nav.clipboard;
});

describe('share in a normal browser', () => {
	it('is unavailable without share or clipboard and reports failure', async () => {
		expect(canShare()).toBe(false);
		expect(await shareText('你好')).toBe('failed');
	});

	it('uses navigator.share where there is one; closing the sheet is cancelled', async () => {
		const share = vi.fn(async () => undefined);
		nav.share = share;
		expect(canShare()).toBe(true);
		expect(await shareText('你好', 'qinqin')).toBe('shared');
		expect(share).toHaveBeenCalledWith({ text: '你好', title: 'qinqin' });
		nav.share = vi.fn().mockRejectedValue(Object.assign(new Error('x'), { name: 'AbortError' }));
		expect(await shareText('你好')).toBe('cancelled');
	});

	it('falls back to the clipboard', async () => {
		const writeText = vi.fn(async () => undefined);
		nav.clipboard = { writeText };
		expect(canShare()).toBe(true);
		expect(await shareText('你好')).toBe('copied');
		expect(writeText).toHaveBeenCalledWith('你好');
	});

	it('nothing to share is a failure, not an empty sheet', async () => {
		nav.share = vi.fn();
		expect(await shareText('  ')).toBe('failed');
	});
});

describe('share in the shell', () => {
	it('opens the system share sheet', async () => {
		const shareTextPlugin = vi.fn(async () => undefined);
		win.Capacitor = { isNativePlatform: () => true, Plugins: { QinqinShare: { shareText: shareTextPlugin } } };
		expect(canShare()).toBe(true);
		expect(await shareText('你好', 'qinqin')).toBe('shared');
		expect(shareTextPlugin).toHaveBeenCalledWith({ text: '你好', title: 'qinqin' });
	});
});
