import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadUrl, fileNameFrom, saveFile } from './files';

const win = window as unknown as { Capacitor?: unknown };

afterEach(() => {
	delete win.Capacitor;
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

function shell(files: Record<string, unknown>) {
	win.Capacitor = { isNativePlatform: () => true, Plugins: { QinqinFiles: files } };
}

describe('saveFile in a normal browser', () => {
	it('clicks a download link for the blob', async () => {
		const created = vi.fn(() => 'blob:x');
		const revoked = vi.fn();
		vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: created, revokeObjectURL: revoked }));
		const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
			expect(this.download).toBe('codes.txt');
			expect(this.href).toBe('blob:x');
		});
		expect(await saveFile('codes.txt', 'text/plain', new Blob(['a']))).toBe('saved');
		expect(click).toHaveBeenCalledOnce();
		expect(revoked).toHaveBeenCalledWith('blob:x');
	});

	it('downloadUrl hands the address to the browser', async () => {
		const assign = vi.fn();
		expect(await downloadUrl('/api/account/export/t', 'x.zip', assign)).toBe('saved');
		expect(assign).toHaveBeenCalledWith('/api/account/export/t');
	});
});

describe('saveFile in the shell', () => {
	it('streams the blob in base64 chunks between begin and finish', async () => {
		const chunks: string[] = [];
		const files = {
			begin: vi.fn(async () => ({ id: 'abc' })),
			append: vi.fn(async ({ data }: { data: string }) => void chunks.push(data)),
			finish: vi.fn(async () => undefined),
			abort: vi.fn(async () => undefined)
		};
		shell(files);
		const bytes = new Uint8Array(5 * 1024 * 1024).fill(65);
		expect(await saveFile('b.zip', 'application/zip', new Blob([bytes]))).toBe('saved');
		expect(files.begin).toHaveBeenCalledWith({ name: 'b.zip', mime: 'application/zip' });
		expect(chunks).toHaveLength(3);
		expect(atob(chunks[0]).length).toBe(2 * 1024 * 1024);
		expect(atob(chunks[2]).length).toBe(1 * 1024 * 1024);
		expect(files.finish).toHaveBeenCalledWith({ id: 'abc' });
		expect(files.abort).not.toHaveBeenCalled();
	});

	it('the person cancelling the save screen is not a failure', async () => {
		shell({ begin: async () => ({ cancelled: true }), append: vi.fn() });
		expect(await saveFile('b.zip', 'application/zip', new Blob(['x']))).toBe('cancelled');
	});

	it('a failed chunk aborts the save', async () => {
		const files = {
			begin: async () => ({ id: 'abc' }),
			append: vi.fn().mockRejectedValue(new Error('write failed')),
			finish: vi.fn(),
			abort: vi.fn(async () => undefined)
		};
		shell(files);
		expect(await saveFile('b.zip', 'application/zip', new Blob(['x']))).toBe('failed');
		expect(files.abort).toHaveBeenCalled();
		expect(files.finish).not.toHaveBeenCalled();
	});

	it('downloadUrl fetches the address and saves the answer under the name the server gave', async () => {
		const files = {
			begin: vi.fn(async () => ({ id: 'abc' })),
			append: vi.fn(async () => undefined),
			finish: vi.fn(async () => undefined),
			abort: vi.fn()
		};
		shell(files);
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('zipbytes', { headers: { 'Content-Disposition': 'attachment; filename="qinqin-me.zip"', 'Content-Type': 'application/zip' } }))
		);
		expect(await downloadUrl('/api/account/export/t', 'fallback.zip')).toBe('saved');
		expect(files.begin).toHaveBeenCalledWith({ name: 'qinqin-me.zip', mime: 'application/zip' });
	});

	it('downloadUrl reports a failed fetch', async () => {
		shell({ begin: vi.fn() });
		vi.stubGlobal('fetch', vi.fn(async () => new Response('no', { status: 410 })));
		expect(await downloadUrl('/x', 'f.zip')).toBe('failed');
	});
});

describe('fileNameFrom', () => {
	it('reads quoted, plain and encoded names, else the fallback', () => {
		expect(fileNameFrom('attachment; filename="a b.zip"', 'f')).toBe('a b.zip');
		expect(fileNameFrom('attachment; filename=a.zip', 'f')).toBe('a.zip');
		expect(fileNameFrom("attachment; filename*=UTF-8''%E6%97%A5.zip", 'f')).toBe('日.zip');
		expect(fileNameFrom(null, 'f')).toBe('f');
		expect(fileNameFrom('inline', 'f')).toBe('f');
	});
});
