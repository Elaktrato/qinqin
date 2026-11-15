import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

import {
	deletePhoto,
	getCapabilities,
	keepPhotoAlive,
	photoObjectUrl,
	requestReview,
	requestSuggestions,
	transcribe,
	uploadPhoto
} from './api';

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status });
}

describe('journal api', () => {
	beforeEach(() => {
		vi.stubGlobal('fetch', vi.fn());
	});
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('requests a review', async () => {
		vi.mocked(fetch).mockResolvedValue(json({ entryId: 'e1' }));
		const controller = new AbortController();
		await requestReview(3, 'e1', controller.signal);
		const [url, init] = vi.mocked(fetch).mock.calls[0];
		expect(url).toBe('/api/journal/review');
		expect(init?.method).toBe('POST');
		expect(JSON.parse(init?.body as string)).toEqual({ workspaceId: 3, entryId: 'e1' });
		expect(init?.signal).toBe(controller.signal);
	});

	it('requests suggestions and capabilities', async () => {
		vi.mocked(fetch).mockImplementation(async () => json({}));
		await requestSuggestions(3);
		expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string)).toEqual({ workspaceId: 3 });
		await getCapabilities(3);
		expect(vi.mocked(fetch).mock.calls[1][0]).toBe('/api/journal/capabilities?workspace=3');
	});

	it('uploads a photo as FormData with file and workspace', async () => {
		vi.mocked(fetch).mockResolvedValue(json({ photoId: 'p1' }, 201));
		const out = await uploadPhoto(3, new Blob(['x'], { type: 'image/jpeg' }));
		expect(out).toEqual({ photoId: 'p1' });
		const [url, init] = vi.mocked(fetch).mock.calls[0];
		expect(url).toBe('/api/journal/photos');
		const form = init?.body as FormData;
		expect(form.get('workspace')).toBe('3');
		expect(form.get('file')).toBeInstanceOf(Blob);
	});

	it('turns the photo into an object URL', async () => {
		vi.mocked(fetch).mockResolvedValue(new Response('IMG'));
		const create = vi.fn(() => 'blob:abc');
		vi.stubGlobal('URL', { createObjectURL: create });
		expect(await photoObjectUrl('p1')).toBe('blob:abc');
		expect(vi.mocked(fetch).mock.calls[0][0]).toBe('/api/journal/photos/p1');
		expect(create).toHaveBeenCalledOnce();
	});

	it('treats a 404 on delete as done and propagates others', async () => {
		vi.mocked(fetch).mockResolvedValueOnce(new Response('not found', { status: 404 }));
		await expect(deletePhoto('p1')).resolves.toBeUndefined();
		expect(vi.mocked(fetch).mock.calls[0][1]?.method).toBe('DELETE');
		vi.mocked(fetch).mockResolvedValueOnce(new Response('boom', { status: 500 }));
		await expect(deletePhoto('p1')).rejects.toMatchObject({ status: 500 });
	});

	it('keeps a photo alive', async () => {
		vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 204 }));
		await keepPhotoAlive('p1');
		const [url, init] = vi.mocked(fetch).mock.calls[0];
		expect(url).toBe('/api/journal/photos/p1/keepalive');
		expect(init?.method).toBe('PUT');
	});

	it('transcribes with the chosen engine', async () => {
		vi.mocked(fetch).mockResolvedValue(json({ text: 't', engine: 'offline', unreadable: false }));
		const out = await transcribe(3, 'p1', 'offline');
		expect(out.text).toBe('t');
		const [url, init] = vi.mocked(fetch).mock.calls[0];
		expect(url).toBe('/api/journal/transcribe');
		expect(JSON.parse(init?.body as string)).toEqual({ workspaceId: 3, photoId: 'p1', engine: 'offline' });
	});
});
