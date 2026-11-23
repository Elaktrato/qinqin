import { t } from '../i18n';
import { ApiError, getToken, isOwnApiPath, notifyErrorAnswer } from './client';

export interface UploadProgress {
	loaded: number;
	total: number;
}

export interface UploadOptions {
	onProgress?: (p: UploadProgress) => void;
	signal?: AbortSignal;
	/** Content-Type for a raw (non-FormData) body, such as application/zip. */
	contentType?: string;
	/** Builds the request object; tests pass a fake. */
	xhr?: () => XMLHttpRequest;
}

function abortError(): DOMException {
	return new DOMException('The upload was cancelled.', 'AbortError');
}

/**
 * uploadWithProgress POSTs a FormData with the bearer token over
 * XMLHttpRequest, which (unlike fetch) reports bytes sent. It maps errors
 * like api(): a non-2xx response rejects with ApiError carrying the
 * plain-text body, a 401 also runs the unauthorized handling, and an
 * aborted signal cancels the request and rejects with an AbortError.
 */
export function uploadWithProgress<T>(path: string, form: FormData | Blob, opts: UploadOptions = {}): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const { signal, onProgress } = opts;
		if (signal?.aborted) {
			reject(abortError());
			return;
		}
		const xhr = opts.xhr ? opts.xhr() : new XMLHttpRequest();
		let finished = false;
		const finish = (fn: () => void) => {
			if (finished) return;
			finished = true;
			signal?.removeEventListener('abort', onAbort);
			fn();
		};
		const onAbort = () => {
			xhr.abort();
			finish(() => reject(abortError()));
		};
		signal?.addEventListener('abort', onAbort);

		xhr.open('POST', path);
		xhr.setRequestHeader('accept', 'application/json');
		if (opts.contentType) xhr.setRequestHeader('content-type', opts.contentType);
		const token = getToken();
		if (token && isOwnApiPath(path)) xhr.setRequestHeader('authorization', `Bearer ${token}`);
		xhr.upload.onprogress = (e) => {
			if (e.lengthComputable) onProgress?.({ loaded: e.loaded, total: e.total });
		};
		xhr.onload = () =>
			finish(() => {
				if (xhr.status >= 200 && xhr.status < 300) {
					try {
						resolve((xhr.responseText ? JSON.parse(xhr.responseText) : undefined) as T);
					} catch {
						reject(new ApiError(xhr.status, t('common.upload.unreadable')));
					}
					return;
				}
				const err = new ApiError(xhr.status, xhr.responseText.trim() || `HTTP ${xhr.status}`);
				notifyErrorAnswer(err);
				reject(err);
			});
		xhr.onerror = () =>
			finish(() => reject(new ApiError(0, t('common.upload.network'))));
		xhr.onabort = () => finish(() => reject(abortError()));
		xhr.send(form);
	});
}
