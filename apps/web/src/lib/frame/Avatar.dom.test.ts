import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { testContext } from '$lib/testing/context';
import Avatar from './Avatar.svelte';

const initial = (name: string) => {
	const { container } = render(Avatar, { name });
	return container.querySelector('.avatar')?.textContent;
};

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

describe('Avatar', () => {
	it('is the first letter, upper-cased; ? for an empty name', () => {
		expect(initial('mei')).toBe('M');
		expect(initial('  li')).toBe('L');
		expect(initial('')).toBe('?');
		expect(initial('学习')).toBe('学');
	});

	it('takes a whole grapheme: combining marks, flags, ZWJ emoji', () => {
		expect(initial('émile')).toBe('É');
		expect(initial('\u{1F1EF}\u{1F1F5}tokyo')).toBe('\u{1F1EF}\u{1F1F5}');
		expect(initial('\u{1F469}‍\u{1F4BB}dev')).toBe('\u{1F469}‍\u{1F4BB}');
		expect(initial('\u{1F44B}\u{1F3FD}hi')).toBe('\u{1F44B}\u{1F3FD}');
	});

	it('keeps a letter whose upper case is longer (ß stays ß, not SS)', () => {
		expect(initial('ßtraße')).toBe('ß');
		expect(initial('ǉubica')).toBe('Ǉ');
	});

	it('falls back to code points without Intl.Segmenter', () => {
		vi.stubGlobal('Intl', { ...Intl, Segmenter: undefined });
		expect(initial('mei')).toBe('M');
		expect(initial('ßa')).toBe('ß');
	});
});

describe('Avatar with a picture', () => {
	const url = '/api/avatars/1/0123456789abcdef0123456789abcdef';
	let made = 0;
	const stub = (answer: () => Response) => {
		made = 0;
		vi.stubGlobal('fetch', vi.fn(async () => answer()));
		// jsdom has no object URLs: give the real URL class the two statics.
		Object.assign(URL, { createObjectURL: () => `blob:pic-${++made}`, revokeObjectURL: () => undefined });
	};

	it('shows the picture once it has loaded, the small file for the bar', async () => {
		stub(() => new Response('jpg', { status: 200 }));
		const ctx = testContext();
		const { container } = render(Avatar, { props: { name: 'mei', src: url }, context: ctx.context });
		expect(container.querySelector('.avatar')?.textContent).toBe('M'); // the letter until it is there
		await waitFor(() => expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:pic-1'));
		expect(vi.mocked(fetch).mock.calls[0][0]).toBe(`${url}?size=64`);
		expect(container.querySelector('img')?.getAttribute('alt')).toBe('');
		expect(container.querySelector('.avatar')?.getAttribute('aria-hidden')).toBe('true');
		expect(container.querySelector('.avatar')?.textContent).toBe('');
	});

	it('falls back to the letter when the picture fails to load or to show', async () => {
		stub(() => new Response('{"error":"not_found","message":"x"}', { status: 404 }));
		const ctx = testContext();
		const failed = render(Avatar, { props: { name: 'mei', src: url }, context: ctx.context });
		await waitFor(() => expect(fetch).toHaveBeenCalled());
		await new Promise((r) => queueMicrotask(() => r(null)));
		expect(failed.container.querySelector('img')).toBeNull();
		expect(failed.container.querySelector('.avatar')?.textContent).toBe('M');
		cleanup();

		stub(() => new Response('not really a jpeg', { status: 200 }));
		const broken = render(Avatar, { props: { name: 'mei', src: url }, context: testContext().context });
		const img = await waitFor(() => {
			const el = broken.container.querySelector('img');
			if (!el) throw new Error('no img yet');
			return el;
		});
		await fireEvent.error(img);
		expect(broken.container.querySelector('img')).toBeNull();
		expect(broken.container.querySelector('.avatar')?.textContent).toBe('M');
	});

	it('loads nothing without a session or without a picture', () => {
		stub(() => new Response('jpg', { status: 200 }));
		render(Avatar, { props: { name: 'mei', src: url }, context: testContext({ user: null }).context });
		render(Avatar, { props: { name: 'mei', src: null }, context: testContext().context });
		expect(fetch).not.toHaveBeenCalled();
	});

	it('names the person when it stands alone (alt)', async () => {
		stub(() => new Response('jpg', { status: 200 }));
		const { container } = render(Avatar, { props: { name: 'mei', src: url, size: 'xl', alt: 'Your profile picture' }, context: testContext().context });
		const box = container.querySelector('.avatar');
		expect(box?.getAttribute('role')).toBe('img');
		expect(box?.getAttribute('aria-label')).toBe('Your profile picture');
		expect(box?.hasAttribute('aria-hidden')).toBe(false);
		await waitFor(() => expect(container.querySelector('img')).not.toBeNull());
		expect(vi.mocked(fetch).mock.calls[0][0]).toBe(url); // 96 px: the 256 px file
	});
});
