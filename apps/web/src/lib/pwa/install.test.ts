import { describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import {
	captureInstallPrompt,
	formatBytes,
	installPrompt,
	isIos,
	isStandalone,
	promptInstall,
	requestPersistOnce
} from './install';

describe('isIos', () => {
	it('recognises iPhone, iPad and the iPad that calls itself a Mac', () => {
		expect(isIos('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', 5)).toBe(true);
		expect(isIos('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)', 5)).toBe(true);
		expect(isIos('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5)).toBe(true);
		expect(isIos('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 0)).toBe(false);
		expect(isIos('Mozilla/5.0 (X11; Linux x86_64) Chrome/120', 0)).toBe(false);
		expect(isIos('Mozilla/5.0 (Linux; Android 14) Chrome/120', 5)).toBe(false);
	});
});

describe('isStandalone', () => {
	it('is true for the display-mode media query or iOS navigator.standalone', () => {
		expect(isStandalone({ matchMedia: () => ({ matches: true }), standalone: undefined })).toBe(true);
		expect(isStandalone({ matchMedia: () => ({ matches: false }), standalone: true })).toBe(true);
		expect(isStandalone({ matchMedia: () => ({ matches: false }), standalone: undefined })).toBe(false);
		expect(isStandalone({ matchMedia: undefined, standalone: undefined })).toBe(false);
	});
});

describe('formatBytes', () => {
	it('formats with one decimal from KB up', () => {
		expect(formatBytes(0)).toBe('0 B');
		expect(formatBytes(999)).toBe('999 B');
		expect(formatBytes(1536)).toBe('1.5 KB');
		expect(formatBytes(12.3 * 1024 * 1024)).toBe('12.3 MB');
		expect(formatBytes(4.2 * 1024 ** 3)).toBe('4.2 GB');
	});
});

describe('install prompt', () => {
	it('captures beforeinstallprompt, defers it, and promptInstall shows it once', async () => {
		const target = new EventTarget();
		const off = captureInstallPrompt(target);
		const prompt = vi.fn(async () => {});
		const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
			prompt,
			userChoice: Promise.resolve({ outcome: 'accepted' as const })
		});
		target.dispatchEvent(event);
		expect(event.defaultPrevented).toBe(true);
		expect(get(installPrompt)).not.toBeNull();
		expect(await promptInstall()).toBe('accepted');
		expect(prompt).toHaveBeenCalledTimes(1);
		expect(get(installPrompt)).toBeNull();
		expect(await promptInstall()).toBe('unavailable');
		off();
	});

	it('appinstalled clears a captured prompt', () => {
		const target = new EventTarget();
		captureInstallPrompt(target);
		target.dispatchEvent(Object.assign(new Event('beforeinstallprompt', { cancelable: true }), { prompt: async () => {}, userChoice: Promise.resolve({ outcome: 'dismissed' as const }) }));
		expect(get(installPrompt)).not.toBeNull();
		target.dispatchEvent(new Event('appinstalled'));
		expect(get(installPrompt)).toBeNull();
	});
});

describe('requestPersistOnce', () => {
	function mem(): Storage {
		const d = new Map<string, string>();
		return { getItem: (k: string) => d.get(k) ?? null, setItem: (k: string, v: string) => void d.set(k, v), removeItem: (k: string) => void d.delete(k) } as Storage;
	}

	it('asks once, and only when running standalone', async () => {
		const persist = vi.fn(async () => true);
		const storage = mem();
		await requestPersistOnce({ standalone: false, persist, storage });
		expect(persist).not.toHaveBeenCalled();
		await requestPersistOnce({ standalone: true, persist, storage });
		await requestPersistOnce({ standalone: true, persist, storage });
		expect(persist).toHaveBeenCalledTimes(1);
	});

	it('never throws without the API', async () => {
		await expect(requestPersistOnce({ standalone: true, persist: undefined, storage: mem() })).resolves.toBeUndefined();
	});
});
