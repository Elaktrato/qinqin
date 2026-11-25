// Saving a file the web app made (a backup, the recovery codes). A browser downloads it itself; the Android
// WebView ignores blob downloads and download navigations, so the shell's QinqinFiles plugin opens the system
// "save as" screen and the bytes are handed over in chunks. Everything that saves goes through saveFile or
// downloadUrl, never through a link of its own.
import { plugin } from './shell';

export interface FilesPlugin {
	begin(options: { name: string; mime: string }): Promise<{ id?: string; cancelled?: boolean }>;
	append(options: { id: string; data: string }): Promise<void>;
	finish(options: { id: string }): Promise<void>;
	abort(options: { id?: string }): Promise<void>;
}

/** saved: handed to the browser or written; cancelled: the person closed the save screen; failed: nothing usable was written. */
export type SaveResult = 'saved' | 'cancelled' | 'failed';

/** 2 MiB of bytes per chunk (about 2.7 MiB of base64, under the plugin's 4 MiB limit). */
const CHUNK = 2 * 1024 * 1024;

const files = (): FilesPlugin | null => plugin<FilesPlugin>('QinqinFiles');

function toBase64(part: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onerror = () => reject(reader.error ?? new Error('read failed'));
		reader.onload = () => {
			const text = String(reader.result);
			resolve(text.slice(text.indexOf(',') + 1));
		};
		reader.readAsDataURL(part);
	});
}

function browserSave(name: string, blob: Blob): SaveResult {
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = name;
	a.click();
	URL.revokeObjectURL(url);
	return 'saved';
}

/** saveFile saves `blob` as `name`: the browser's download, or the shell's save screen. */
export async function saveFile(name: string, mime: string, blob: Blob): Promise<SaveResult> {
	const shell = files();
	if (shell === null) return browserSave(name, blob);
	let id: string | undefined;
	try {
		const started = await shell.begin({ name, mime });
		if (started.cancelled || !started.id) return started.cancelled ? 'cancelled' : 'failed';
		id = started.id;
		for (let at = 0; at < blob.size; at += CHUNK) {
			await shell.append({ id, data: await toBase64(blob.slice(at, at + CHUNK)) });
		}
		await shell.finish({ id });
		return 'saved';
	} catch {
		await Promise.resolve(shell.abort({ id })).catch(() => undefined);
		return 'failed';
	}
}

/** fileNameFrom reads the name out of a Content-Disposition header; `fallback` when it has none. */
export function fileNameFrom(header: string | null, fallback: string): string {
	if (!header) return fallback;
	const star = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(header);
	if (star) {
		try {
			return decodeURIComponent(star[1].trim());
		} catch {
			// fall through to the plain form
		}
	}
	const plain = /filename\s*=\s*(?:"([^"]+)"|([^;]+))/i.exec(header);
	const name = (plain?.[1] ?? plain?.[2] ?? '').trim();
	return name || fallback;
}

/**
 * downloadUrl downloads a same-origin address (a one-time backup ticket, which needs no bearer token). A browser
 * navigates to it (`assign`, replaceable for tests); in the shell the page fetches it and saves the answer.
 */
export async function downloadUrl(url: string, fallbackName: string, assign: (url: string) => void = (u) => location.assign(u)): Promise<SaveResult> {
	if (files() === null) {
		assign(url);
		return 'saved';
	}
	try {
		const res = await fetch(url);
		if (!res.ok) return 'failed';
		const blob = await res.blob();
		const name = fileNameFrom(res.headers.get('Content-Disposition'), fallbackName);
		return await saveFile(name, res.headers.get('Content-Type') ?? blob.type ?? 'application/octet-stream', blob);
	} catch {
		return 'failed';
	}
}
