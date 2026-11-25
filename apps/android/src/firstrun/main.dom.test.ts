// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The first-run screen end to end in jsdom, with the Capacitor plugins faked: what a person sees and which
// native calls it makes. (The real WebView run is in the plan's manual steps.)
const { shell, http, app } = vi.hoisted(() => ({
	shell: {
		getServer: vi.fn(async () => ({ url: null as string | null, lastUrl: null as string | null })),
		setServer: vi.fn(async (_: { url: string }) => undefined),
		clearServer: vi.fn(async () => undefined),
		retry: vi.fn(async () => undefined)
	},
	http: { get: vi.fn() },
	app: {
		addListener: vi.fn(async (_: string, __: () => void) => ({ remove: async () => undefined })),
		minimizeApp: vi.fn(async () => undefined)
	}
}));

vi.mock('@capacitor/core', () => ({ CapacitorHttp: http, registerPlugin: () => shell }));
vi.mock('@capacitor/app', () => ({ App: app }));

const page = readFileSync(join(process.cwd(), 'src/firstrun/index.html'), 'utf8');
const answer = { app: 'qinqin', version: '0.7.0', contract: 2, bridge: { level: 1, features: [] } };

async function load(search = ''): Promise<void> {
	vi.resetModules();
	document.documentElement.innerHTML = page.replace(/<!doctype html>|<\/?html[^>]*>/gi, '');
	history.replaceState(null, '', `/index.html${search}`);
	await import('./main');
	await vi.waitFor(() => expect(document.getElementById('title')!.textContent).not.toBe(''));
}

async function enter(text: string): Promise<void> {
	const input = document.getElementById('address') as HTMLInputElement;
	input.value = text;
	document.getElementById('form')!.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
}

const text = (id: string) => document.getElementById(id)!.textContent ?? '';
const buttons = () => [...document.querySelectorAll<HTMLButtonElement>('#actions button')].map((b) => b.textContent);

beforeEach(() => {
	vi.clearAllMocks();
	shell.getServer.mockResolvedValue({ url: null, lastUrl: null });
});

describe('first-run screen', () => {
	it('is labelled, and the field is a labelled url input', async () => {
		await load();
		expect(text('title')).toBe('Connect to your server');
		expect(document.querySelector('label[for="address"]')!.textContent).toBe('Server address');
		const input = document.getElementById('address') as HTMLInputElement;
		expect(input.getAttribute('inputmode')).toBe('url');
		expect(document.getElementById('problem')!.getAttribute('role')).toBe('alert');
		expect(document.getElementById('status')!.getAttribute('aria-live')).toBe('polite');
	});

	it('a good address: checks /api/version natively, shows the version, saves only on "Open qinqin"', async () => {
		http.get.mockResolvedValue({ status: 200, url: 'https://q.example.org/api/version', data: answer });
		await load();
		await enter('q.example.org/study?x=1');
		await vi.waitFor(() => expect(buttons()).toEqual(['Open qinqin']));
		expect(http.get.mock.calls[0][0]).toMatchObject({ url: 'https://q.example.org/api/version' });
		expect(text('notes')).toContain('Found qinqin 0.7.0.');
		expect(text('notes')).toContain('Only the server');
		expect(shell.setServer).not.toHaveBeenCalled();
		document.querySelector<HTMLButtonElement>('#actions button')!.click();
		expect(shell.setServer).toHaveBeenCalledWith({ url: 'https://q.example.org' });
	});

	it('when the shell refuses the address, the screen says it is invalid instead of staying silent', async () => {
		http.get.mockResolvedValue({ status: 200, url: 'https://q.example.org/api/version', data: answer });
		shell.setServer.mockRejectedValueOnce(new Error('not an allowed origin'));
		await load();
		await enter('q.example.org');
		await vi.waitFor(() => expect(buttons()).toEqual(['Open qinqin']));
		document.querySelector<HTMLButtonElement>('#actions button')!.click();
		await vi.waitFor(() => expect(document.getElementById('problem')!.hidden).toBe(false));
		expect(text('problem')).toBe('That is not a valid address.');
		expect(buttons()).toEqual([]);
	});

	it('a private http address is allowed with a visible warning', async () => {
		http.get.mockResolvedValue({ status: 200, url: 'http://10.0.2.2:8085/api/version', data: answer });
		await load();
		await enter('http://10.0.2.2:8085');
		await vi.waitFor(() => expect(buttons()).toEqual(['Open qinqin']));
		expect(text('notes')).toContain('plain http');
	});

	it('a public http address is refused before any request', async () => {
		await load();
		await enter('http://example.com');
		expect(text('problem')).toContain('must use https');
		expect(document.getElementById('problem')!.hidden).toBe(false);
		expect(document.getElementById('address')!.getAttribute('aria-invalid')).toBe('true');
		expect(http.get).not.toHaveBeenCalled();
	});

	it.each([
		[{ code: 'SocketTimeoutException', message: 'x' }, 'did not answer in time'],
		[{ code: 'SSLHandshakeException', message: 'x' }, 'certificate'],
		[{ code: 'UnknownHostException', message: 'x' }, 'Could not reach the server']
	])('names the failure %j', async (err, words) => {
		http.get.mockRejectedValue(err);
		await load();
		await enter('https://q.example.org');
		await vi.waitFor(() => expect(text('notes')).toContain(words));
		expect(buttons()).toEqual([]);
	});

	it('an address that is not qinqin', async () => {
		http.get.mockResolvedValue({ status: 200, url: 'https://example.org/api/version', data: '<html>' });
		await load();
		await enter('https://example.org');
		await vi.waitFor(() => expect(text('notes')).toContain('not a qinqin server'));
	});

	it('a redirect to another host offers to use that address', async () => {
		http.get.mockResolvedValue({ status: 200, url: 'https://other.example.net/api/version', data: answer });
		await load();
		await enter('https://q.example.org');
		await vi.waitFor(() => expect(buttons()).toEqual(['Use https://other.example.net']));
		expect(text('notes')).toContain('redirects to https://other.example.net');
	});

	it('warns when the app is older than the server expects', async () => {
		http.get.mockResolvedValue({ status: 200, url: 'https://q.example.org/api/version', data: { ...answer, bridge: { level: 2, features: ['tts'] } } });
		await load();
		await enter('https://q.example.org');
		await vi.waitFor(() => expect(text('notes')).toContain('older than the server expects'));
		expect(text('notes')).toContain('Missing in this app: tts.');
		expect(buttons()).toEqual(['Open qinqin']);
	});

	it('fills the form with the server used last', async () => {
		shell.getServer.mockResolvedValue({ url: null, lastUrl: 'https://old.example.org' });
		await load();
		await vi.waitFor(() => expect((document.getElementById('address') as HTMLInputElement).value).toBe('https://old.example.org'));
	});

	it('Back leaves the app (nothing is behind this screen)', async () => {
		await load();
		expect(app.addListener).toHaveBeenCalledWith('backButton', expect.any(Function));
		app.addListener.mock.calls[0][1]();
		expect(app.minimizeApp).toHaveBeenCalled();
	});
});

describe('first-run screen as the error screen of a saved server', () => {
	it('names the failure and offers Try again and Change server', async () => {
		await load('?error=unreachable&server=https%3A%2F%2Fq.example.org');
		expect(text('notes')).toContain('Could not reach https://q.example.org');
		expect(buttons()).toEqual(['Try again', 'Change server']);
		expect((document.getElementById('form') as HTMLFormElement).hidden).toBe(true);
		document.querySelectorAll<HTMLButtonElement>('#actions button')[0].click();
		expect(shell.retry).toHaveBeenCalled();
	});

	it('a saved server that answers with something else, or a too-old WebView, gets its own message', async () => {
		await load('?error=notQinqin&server=https%3A%2F%2Fq.example.org');
		expect(text('notes')).toContain('not like a qinqin server');
		expect(buttons()).toEqual(['Try again', 'Change server']);
		await load('?error=webview&server=https%3A%2F%2Fq.example.org');
		expect(text('notes')).toContain('Update Android System WebView');
	});

	it('Change server shows the form again, filled with the address', async () => {
		await load('?error=tls&server=https%3A%2F%2Fq.example.org');
		expect(text('notes')).toContain('certificate');
		document.querySelectorAll<HTMLButtonElement>('#actions button')[1].click();
		expect((document.getElementById('form') as HTMLFormElement).hidden).toBe(false);
		expect((document.getElementById('address') as HTMLInputElement).value).toBe('https://q.example.org');
		expect(shell.setServer).not.toHaveBeenCalled();
	});
});
