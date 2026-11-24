import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testContext, type TestContext } from '$lib/testing/context';

vi.mock('./avatarPicture', () => ({ OUTPUT_PX: 512, cropToBlob: vi.fn(async () => new Blob(['png'], { type: 'image/png' })) }));

import { cropToBlob } from './avatarPicture';
import ProfilePicture from './ProfilePicture.svelte';

const url = '/api/avatars/1/0123456789abcdef0123456789abcdef';
let ctx: TestContext;
let answers: Record<string, () => Response>;

beforeEach(() => {
	ctx = testContext({ user: { username: 'mei' } });
	vi.spyOn(ctx.app.auth, 'loadMe').mockResolvedValue(null);
	answers = {
		'POST /api/account/avatar': () => new Response(JSON.stringify({ avatarUrl: url }), { status: 200 }),
		'DELETE /api/account/avatar': () => new Response(null, { status: 204 })
	};
	vi.stubGlobal(
		'fetch',
		vi.fn(async (path: string, init?: RequestInit) => {
			const answer = answers[`${init?.method ?? 'GET'} ${path.split('?')[0]}`];
			return answer ? answer() : new Response('jpg', { status: 200 });
		})
	);
	Object.assign(URL, { createObjectURL: () => 'blob:chosen', revokeObjectURL: vi.fn() });
});
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.clearAllMocks();
});

function fileInput(container: HTMLElement): HTMLInputElement {
	return container.querySelector('input[type="file"]') as HTMLInputElement;
}

/** Chooses a picture and lets the browser "decode" it at w×h. */
async function choose(container: HTMLElement, w = 800, h = 600): Promise<HTMLElement> {
	const input = fileInput(container);
	Object.defineProperty(input, 'files', { value: [new File(['x'], 'me.jpg', { type: 'image/jpeg' })], configurable: true });
	await fireEvent.change(input);
	const img = await waitFor(() => {
		const el = container.querySelector('.crop img') as HTMLImageElement | null;
		if (!el) throw new Error('no crop yet');
		return el;
	});
	Object.defineProperty(img, 'naturalWidth', { value: w, configurable: true });
	Object.defineProperty(img, 'naturalHeight', { value: h, configurable: true });
	await fireEvent.load(img);
	return screen.getByRole('application', { name: 'Crop your picture' });
}

describe('ProfilePicture', () => {
	it('offers a plain image file input (camera and photo picker on a phone) and the letter without a picture', () => {
		const { container } = render(ProfilePicture, { context: ctx.context });
		const input = fileInput(container);
		expect(input.accept).toBe('image/jpeg,image/png,image/webp');
		expect(screen.getByRole('button', { name: 'Choose a picture' })).toBeTruthy();
		expect(screen.queryByRole('button', { name: 'Remove picture' })).toBeNull();
		expect(screen.getByRole('img', { name: 'Your profile picture' }).textContent).toBe('M');
	});

	it('crops with the keyboard and the slider, and focus moves into the crop area and back', async () => {
		const { container } = render(ProfilePicture, { context: ctx.context });
		const area = await choose(container);
		await waitFor(() => expect(document.activeElement).toBe(area));
		expect(area.getAttribute('aria-describedby')).toBeTruthy();
		const img = container.querySelector('.crop img') as HTMLImageElement;
		const left = img.style.left;
		await fireEvent.keyDown(area, { key: 'ArrowRight' });
		expect(img.style.left).not.toBe(left);
		const zoom = screen.getByRole('slider', { name: 'Zoom' }) as HTMLInputElement;
		expect(zoom.value).toBe('1');
		await fireEvent.keyDown(area, { key: '+' });
		expect(Number(zoom.value)).toBeGreaterThan(1);
		await fireEvent.input(zoom, { target: { value: '3' } });
		expect(img.style.width).toBe(`${(240 / 600) * 3 * 800}px`);
		await fireEvent.keyDown(area, { key: 'Escape' });
		expect(container.querySelector('.crop')).toBeNull();
		await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Choose a picture' })));
	});

	it('drags with a pointer and pinches with two', async () => {
		const { container } = render(ProfilePicture, { context: ctx.context });
		const area = await choose(container);
		const img = container.querySelector('.crop img') as HTMLImageElement;
		const left = img.style.left;
		await fireEvent.pointerDown(area, { pointerId: 1, clientX: 100, clientY: 100 });
		await fireEvent.pointerMove(area, { pointerId: 1, clientX: 130, clientY: 100 });
		expect(parseFloat(img.style.left)).toBeCloseTo(parseFloat(left) + 30, 5);
		await fireEvent.pointerDown(area, { pointerId: 2, clientX: 150, clientY: 100 });
		await fireEvent.pointerMove(area, { pointerId: 2, clientX: 170, clientY: 100 });
		const zoom = screen.getByRole('slider', { name: 'Zoom' }) as HTMLInputElement;
		expect(Number(zoom.value)).toBeCloseTo(2, 5);
		await fireEvent.pointerUp(area, { pointerId: 2 });
		await fireEvent.pointerUp(area, { pointerId: 1 });
	});

	it('uploads the cropped square, reloads me and says so', async () => {
		const { container } = render(ProfilePicture, { context: ctx.context });
		await choose(container, 800, 600);
		await fireEvent.click(screen.getByRole('button', { name: 'Save picture' }));
		await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Profile picture saved.'));
		expect(vi.mocked(cropToBlob).mock.calls[0][1]).toEqual({ sx: 100, sy: 0, size: 600 });
		const post = vi.mocked(fetch).mock.calls.find(([, init]) => (init as RequestInit)?.method === 'POST');
		expect(post?.[0]).toBe('/api/account/avatar');
		expect(((post?.[1] as RequestInit).body as FormData).get('file')).toBeInstanceOf(Blob);
		expect(ctx.app.auth.loadMe).toHaveBeenCalled();
		expect(container.querySelector('.crop')).toBeNull();
	});

	it('shows the refusal by its code and keeps the crop open', async () => {
		answers['POST /api/account/avatar'] = () =>
			new Response(JSON.stringify({ error: 'animated_image', message: 'x' }), { status: 415 });
		const { container } = render(ProfilePicture, { context: ctx.context });
		await choose(container);
		await fireEvent.click(screen.getByRole('button', { name: 'Save picture' }));
		await waitFor(() => expect(screen.getByRole('alert').textContent).toBe("Animated pictures can't be used. Choose a still picture."));
		expect(container.querySelector('.crop')).not.toBeNull();
	});

	it('says so when the browser cannot open the file', async () => {
		const { container } = render(ProfilePicture, { context: ctx.context });
		const input = fileInput(container);
		Object.defineProperty(input, 'files', { value: [new File(['x'], 'broken.jpg', { type: 'image/jpeg' })], configurable: true });
		await fireEvent.change(input);
		const img = await waitFor(() => container.querySelector('.crop img') as HTMLImageElement);
		await fireEvent.error(img);
		expect(screen.getByRole('alert').textContent).toBe('This picture cannot be opened here. Choose a JPEG, PNG or WebP photo.');
		expect(container.querySelector('.crop')).toBeNull();
	});

	it('replaces and removes an existing picture', async () => {
		ctx.app.auth.set({ token: 'tok', user: { ...ctx.app.auth.user!, avatarUrl: url } });
		render(ProfilePicture, { context: ctx.context });
		expect(screen.getByRole('button', { name: 'Replace picture' })).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: 'Remove picture' }));
		await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Profile picture removed.'));
		expect(vi.mocked(fetch).mock.calls.some(([p, init]) => p === '/api/account/avatar' && (init as RequestInit)?.method === 'DELETE')).toBe(true);
		expect(ctx.app.auth.loadMe).toHaveBeenCalled();
	});
});

describe('ProfilePicture: the fix wave', () => {
	async function pick(input: HTMLInputElement, file: File): Promise<void> {
		Object.defineProperty(input, 'files', { value: [file], configurable: true });
		await fireEvent.change(input);
	}

	it('refuses a file of another type before anything is opened (GIF, SVG, AVIF, BMP)', async () => {
		const { container } = render(ProfilePicture, { context: ctx.context });
		for (const [name, type] of [['a.gif', 'image/gif'], ['a.svg', 'image/svg+xml'], ['a.avif', 'image/avif'], ['a.bmp', 'image/bmp'], ['a.txt', '']]) {
			await pick(fileInput(container), new File(['x'], name, { type }));
			expect(screen.getByRole('alert').textContent).toBe('Only JPEG, PNG and WebP pictures can be used.');
			expect(container.querySelector('.crop')).toBeNull();
		}
		// A file without a type is judged by its name.
		await pick(fileInput(container), new File(['x'], 'photo.JPG', { type: '' }));
		expect(container.querySelector('.crop')).not.toBeNull();
	});

	it('offers Take a photo with the front camera on a touch screen, with the same type check', async () => {
		const coarse = vi.fn((q: string) => ({ matches: q === '(pointer: coarse)', addEventListener() {}, removeEventListener() {} }));
		vi.stubGlobal('matchMedia', coarse);
		const { container } = render(ProfilePicture, { context: ctx.context });
		expect(screen.getByRole('button', { name: 'Take a photo' })).toBeTruthy();
		const camera = container.querySelector('input[capture]') as HTMLInputElement;
		expect(camera.getAttribute('capture')).toBe('user');
		expect(camera.accept).toBe('image/*');
		await pick(camera, new File(['x'], 'shot.heic', { type: 'image/heic' }));
		expect(screen.getByRole('alert').textContent).toBe('Only JPEG, PNG and WebP pictures can be used.');
		await pick(camera, new File(['x'], 'shot.jpg', { type: 'image/jpeg' }));
		expect(container.querySelector('.crop')).not.toBeNull();
	});

	it('offers no camera button with a mouse', () => {
		vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
		render(ProfilePicture, { context: ctx.context });
		expect(screen.queryByRole('button', { name: 'Take a photo' })).toBeNull();
	});

	it('says the picture is saved even when reloading the account fails afterwards', async () => {
		vi.mocked(ctx.app.auth.loadMe).mockRejectedValue(new Error('offline'));
		const { container } = render(ProfilePicture, { context: ctx.context });
		await choose(container);
		await fireEvent.click(screen.getByRole('button', { name: 'Save picture' }));
		await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Profile picture saved.'));
		expect(screen.queryByRole('alert')).toBeNull();
	});
});
