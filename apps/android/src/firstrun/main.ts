// The first-run screen (bundled in the APK, shown at https://localhost): ask for the server address, check it,
// save it natively and let the shell load the server's web app. It is also the error screen: when the saved
// server could not be reached the shell comes back here with ?error=<kind>&server=<address>.
// The decisions are in address.ts and verify.ts (tested); this file is the DOM and the plugin calls.
import { CapacitorHttp, registerPlugin } from '@capacitor/core';
import { App } from '@capacitor/app';
import { normalizeAddress } from './address';
import { S } from './strings';
import { verifyServer, type HttpFn, type VerifyResult } from './verify';

interface ShellPlugin {
	getServer(): Promise<{ url: string | null; lastUrl: string | null }>;
	setServer(options: { url: string }): Promise<void>;
	clearServer(): Promise<void>;
	retry(): Promise<void>;
}
const Shell = registerPlugin<ShellPlugin>('QinqinShell');

const TIMEOUT_MS = 10_000;

// The native HTTP path: no CORS, and the error's `code` is the Java exception (verify.ts classifies it).
const http: HttpFn = async (url) => {
	const answer = await Promise.race([
		CapacitorHttp.get({ url, connectTimeout: TIMEOUT_MS, readTimeout: TIMEOUT_MS, headers: { Accept: 'application/json' } }),
		new Promise<never>((_, reject) => setTimeout(() => reject({ code: 'SocketTimeoutException', message: 'timeout' }), TIMEOUT_MS + 2000))
	]);
	return { status: answer.status, url: answer.url, data: answer.data };
};

const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const form = el<HTMLFormElement>('form');
const input = el<HTMLInputElement>('address');
const problem = el('problem');
const status = el('status');
const notes = el('notes');
const actions = el('actions');
const connect = el<HTMLButtonElement>('connect');

function note(kind: 'warn' | 'good' | 'bad', text: string): void {
	const p = document.createElement('p');
	p.className = `note ${kind}`;
	p.textContent = text;
	notes.append(p);
}

function button(label: string, onclick: () => void, primary = false): HTMLButtonElement {
	const b = document.createElement('button');
	b.type = 'button';
	b.textContent = label;
	if (primary) b.className = 'primary';
	b.addEventListener('click', onclick);
	return b;
}

function clear(): void {
	problem.hidden = true;
	problem.textContent = '';
	status.textContent = '';
	notes.replaceChildren();
	actions.replaceChildren();
}

function showForm(visible: boolean): void {
	form.hidden = !visible;
	el('title').hidden = !visible;
	el('intro').hidden = !visible;
}

function failureText(r: Extract<VerifyResult, { ok: false }>): string {
	if (r.kind === 'redirect') return S.failure.redirect(r.target);
	return S.failure[r.kind];
}

async function submit(): Promise<void> {
	clear();
	const a = normalizeAddress(input.value);
	if (!a.ok) {
		problem.textContent = S.problem[a.reason];
		problem.hidden = false;
		input.setAttribute('aria-invalid', 'true');
		input.focus();
		return;
	}
	input.removeAttribute('aria-invalid');
	input.value = a.url;
	if (a.cleartext) note('warn', S.cleartextWarning);
	if (a.droppedPath) note('warn', S.droppedPath(a.url));
	connect.disabled = true;
	status.textContent = S.checking;
	const r = await verifyServer(a.url, http);
	connect.disabled = false;
	status.textContent = '';
	if (!r.ok) {
		note('bad', failureText(r));
		if (r.kind === 'redirect') {
			const target = normalizeAddress(r.target);
			if (target.ok) {
				actions.append(
					button(S.useAddress(target.url), () => {
						input.value = target.url;
						void submit();
					})
				);
			}
		}
		input.focus();
		return;
	}
	note('good', S.connected(r.version));
	if (r.compat.status === 'shellOutdated') {
		note('warn', S.compat.shellOutdated);
		if (r.compat.missing.length > 0) note('warn', S.compat.missing(r.compat.missing.join(', ')));
	} else if (r.compat.status === 'serverOutdated') {
		note('warn', S.compat.serverOutdated);
	}
	const open = button(S.open, () => void Shell.setServer({ url: a.url }), true);
	actions.append(open);
	open.focus();
}

function labels(): void {
	el('title').textContent = S.title;
	el('intro').textContent = S.intro;
	el('address-label').textContent = S.addressLabel;
	el('hint').textContent = S.addressHint;
	connect.textContent = S.connect;
}

async function start(): Promise<void> {
	labels();
	const params = new URLSearchParams(location.search);
	const server = params.get('server');
	const error = params.get('error');
	if (server) input.value = server;
	else {
		try {
			const saved = await Shell.getServer();
			if (saved.lastUrl) input.value = saved.lastUrl;
		} catch {
			// No plugin (the page opened in a browser): the form still works for a look.
		}
	}
	form.addEventListener('submit', (e) => {
		e.preventDefault();
		void submit();
	});
	// Back from the first-run screen leaves the app (there is nothing behind it).
	void App.addListener('backButton', () => void App.minimizeApp());
	if (server && (error === 'unreachable' || error === 'timeout' || error === 'tls')) {
		showForm(false);
		const h = document.createElement('h1');
		h.textContent = 'qinqin';
		notes.append(h);
		note('bad', S.savedFailure[error](server));
		const retry = button(S.retry, () => void Shell.retry(), true);
		actions.append(retry, button(S.changeServer, () => {
			clear();
			showForm(true);
			input.focus();
		}));
		retry.focus();
	}
}

void start();
