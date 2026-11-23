import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { goto } = vi.hoisted(() => ({ goto: vi.fn() }));
vi.mock('$app/navigation', () => ({ goto }));

import { ApiError, setRestrictedHandler, setUnauthorizedHandler, setWorkspaceGoneHandler } from './client';
import { uploadWithProgress } from './upload';
import { installStaged, stagedStatus, waitForImport, type StagedStatus } from './packs';

class FakeXHR {
	method = '';
	url = '';
	headers: Record<string, string> = {};
	body: unknown = null;
	aborted = false;
	status = 0;
	responseText = '';
	upload: { onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = {
		onprogress: null
	};
	onload: (() => void) | null = null;
	onerror: (() => void) | null = null;
	onabort: (() => void) | null = null;
	open(method: string, url: string) {
		this.method = method;
		this.url = url;
	}
	setRequestHeader(k: string, v: string) {
		this.headers[k.toLowerCase()] = v;
	}
	send(body: unknown) {
		this.body = body;
	}
	abort() {
		this.aborted = true;
		this.onabort?.();
	}
	finish(status: number, text: string) {
		this.status = status;
		this.responseText = text;
		this.onload?.();
	}
}

function setup() {
	const x = new FakeXHR();
	return { x, xhr: () => x as unknown as XMLHttpRequest };
}

describe('uploadWithProgress', () => {
	beforeEach(() => {
		vi.stubGlobal('localStorage', { getItem: () => 'tok-1', setItem() {}, removeItem() {} });
		goto.mockReset();
	});
	afterEach(() => {
		vi.unstubAllGlobals();
		setUnauthorizedHandler(null);
	});

	it('sends the bearer token and forwards progress', async () => {
		const { x, xhr } = setup();
		const seen: { loaded: number; total: number }[] = [];
		const p = uploadWithProgress<{ token: string }>('/api/admin/packs', new FormData(), {
			xhr,
			onProgress: (e) => seen.push(e)
		});
		expect(x.method).toBe('POST');
		expect(x.url).toBe('/api/admin/packs');
		expect(x.headers.authorization).toBe('Bearer tok-1');
		x.upload.onprogress?.({ lengthComputable: true, loaded: 5, total: 10 });
		x.upload.onprogress?.({ lengthComputable: false, loaded: 7, total: 0 });
		x.finish(201, '{"token":"abc"}');
		await expect(p).resolves.toEqual({ token: 'abc' });
		expect(seen).toEqual([{ loaded: 5, total: 10 }]);
	});

	it('rejects with the plain-text body as an ApiError', async () => {
		const { x, xhr } = setup();
		const p = uploadWithProgress('/api/admin/packs', new FormData(), { xhr });
		x.finish(400, 'invalid pack: license is required\n');
		const err = (await p.catch((e: Error) => e)) as ApiError;
		expect(err).toBeInstanceOf(ApiError);
		expect(err.status).toBe(400);
		expect(err.message).toBe('invalid pack: license is required');
	});

	it('treats a 401 like api(): clears the token and runs the handler once', async () => {
		const { x, xhr } = setup();
		const handler = vi.fn();
		setUnauthorizedHandler(handler);
		const p = uploadWithProgress('/api/admin/packs', new FormData(), { xhr });
		x.finish(401, 'unauthorized');
		await expect(p).rejects.toMatchObject({ status: 401 });
		expect(handler).toHaveBeenCalledTimes(1);
	});

	it('tells the workspace-gone and restriction handlers, like api() (#168 review)', async () => {
		const gone = vi.fn();
		const restricted = vi.fn();
		setWorkspaceGoneHandler(gone);
		setRestrictedHandler(restricted);
		try {
			let { x, xhr } = setup();
			let p = uploadWithProgress('/api/library/upload', new FormData(), { xhr });
			x.finish(404, JSON.stringify({ error: 'workspace_not_found', message: 'No such workspace.' }));
			await expect(p).rejects.toMatchObject({ status: 404, code: 'workspace_not_found' });
			expect(gone).toHaveBeenCalledTimes(1);
			({ x, xhr } = setup());
			p = uploadWithProgress('/api/library/upload', new FormData(), { xhr });
			x.finish(403, JSON.stringify({ error: 'password_change_required', message: 'x' }));
			await expect(p).rejects.toMatchObject({ status: 403 });
			expect(restricted).toHaveBeenCalledTimes(1);
			({ x, xhr } = setup());
			p = uploadWithProgress('/api/library/upload', new FormData(), { xhr });
			x.finish(404, JSON.stringify({ error: 'not_found', message: 'x' }));
			await expect(p).rejects.toMatchObject({ status: 404 });
			expect(gone).toHaveBeenCalledTimes(1);
		} finally {
			setWorkspaceGoneHandler(null);
			setRestrictedHandler(null);
		}
	});

	it('aborts through the signal and rejects with AbortError', async () => {
		const { x, xhr } = setup();
		const ctl = new AbortController();
		const p = uploadWithProgress('/api/admin/packs', new FormData(), { xhr, signal: ctl.signal });
		ctl.abort();
		expect(x.aborted).toBe(true);
		const err = (await p.catch((e: Error) => e)) as Error;
		expect(err).toBeInstanceOf(DOMException);
		expect(err.name).toBe('AbortError');
	});

	it('rejects at once for an already aborted signal without sending', async () => {
		const { x, xhr } = setup();
		const ctl = new AbortController();
		ctl.abort();
		const err = (await uploadWithProgress('/p', new FormData(), { xhr, signal: ctl.signal }).catch((e: Error) => e)) as Error;
		expect(err.name).toBe('AbortError');
		expect(x.body).toBeNull();
	});

	it('rejects a network error with a readable message', async () => {
		const { x, xhr } = setup();
		const p = uploadWithProgress('/p', new FormData(), { xhr });
		x.onerror?.();
		await expect(p).rejects.toThrow(/network/i);
	});
});

describe('pack calls', () => {
	beforeEach(() => {
		vi.stubGlobal('localStorage', { getItem: () => 'tok-1', setItem() {}, removeItem() {} });
	});
	afterEach(() => vi.unstubAllGlobals());

	it('installStaged posts the licence and resolves on 202', async () => {
		const fetchMock = vi.fn().mockResolvedValue(new Response('{"status":"importing"}', { status: 202 }));
		vi.stubGlobal('fetch', fetchMock);
		await installStaged('t1', 'CC0-1.0');
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe('/api/admin/packs/staged/t1');
		expect(init.method).toBe('POST');
		expect(JSON.parse(init.body)).toEqual({ license: 'CC0-1.0' });
	});

	it('waitForImport polls every 2000 ms until done', async () => {
		const seq: StagedStatus[] = [{ status: 'importing' }, { status: 'importing' }, { status: 'done', summary: '4 entries' }];
		let i = 0;
		vi.stubGlobal(
			'fetch',
			vi.fn().mockImplementation(async () => new Response(JSON.stringify(seq[i++]), { status: 200 }))
		);
		const sleeps: number[] = [];
		const out = await waitForImport('t1', { sleep: async (ms) => void sleeps.push(ms) });
		expect(out).toEqual({ status: 'done', summary: '4 entries' });
		expect(sleeps).toEqual([2000, 2000]);
	});

	it('waitForImport stops on failed and on abort', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockImplementation(async () => new Response('{"status":"failed","error":"invalid pack: x"}', { status: 200 }))
		);
		expect((await waitForImport('t1', { sleep: async () => {} })).status).toBe('failed');

		vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response('{"status":"importing"}', { status: 200 })));
		const ctl = new AbortController();
		const p = waitForImport('t1', {
			signal: ctl.signal,
			sleep: async () => {
				ctl.abort();
			}
		});
		const err = (await p.catch((e: Error) => e)) as Error;
		expect(err.name).toBe('AbortError');
	});

	it('stagedStatus reads the status route', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"status":"staged"}', { status: 200 })));
		expect(await stagedStatus('t1')).toEqual({ status: 'staged' });
	});
});
