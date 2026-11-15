// The photo import flow as a pure state machine. The component performs
// the side effects (upload, read, delete) and feeds results back as events.

import type { AiErrorView } from './aiErrors';

export type Engine = 'ai' | 'offline';

export type PhotoState =
	| { step: 'pick' }
	| { step: 'uploading' }
	| { step: 'choose'; photoId: string }
	| { step: 'reading'; photoId: string; engine: Engine }
	| { step: 'draft'; photoId: string; text: string; engine: Engine; unreadable: boolean; expired?: boolean }
	| { step: 'error'; photoId: string | null; view: AiErrorView }
	| { step: 'done' };

export type PhotoEvent =
	| { type: 'picked' }
	| { type: 'uploaded'; photoId: string }
	| { type: 'read'; engine: Engine }
	| { type: 'readDone'; text: string; unreadable: boolean }
	| { type: 'failed'; view: AiErrorView }
	| { type: 'photoExpired'; view: AiErrorView }
	| { type: 'edit'; text: string }
	| { type: 'saved' }
	| { type: 'discarded' };

export const KEEPALIVE_MS = 10 * 60 * 1000;
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const DOWNSCALE_EDGE = 3000;

export function photoReducer(state: PhotoState, event: PhotoEvent): PhotoState {
	switch (event.type) {
		case 'picked':
			return state.step === 'pick' || (state.step === 'error' && state.photoId === null)
				? { step: 'uploading' }
				: state;
		case 'uploaded':
			return state.step === 'uploading' ? { step: 'choose', photoId: event.photoId } : state;
		case 'read':
			if (state.step === 'choose') return { step: 'reading', photoId: state.photoId, engine: event.engine };
			if (state.step === 'error' && state.photoId !== null) {
				return { step: 'reading', photoId: state.photoId, engine: event.engine };
			}
			return state;
		case 'readDone':
			return state.step === 'reading'
				? {
						step: 'draft',
						photoId: state.photoId,
						text: event.text,
						engine: state.engine,
						unreadable: event.unreadable
					}
				: state;
		case 'failed': {
			if (state.step === 'done' || state.step === 'error') return state;
			const photoId = 'photoId' in state ? state.photoId : null;
			return { step: 'error', photoId, view: event.view };
		}
		case 'photoExpired':
			if (state.step === 'draft') return { ...state, expired: true };
			if (state.step === 'done' || state.step === 'pick') return state;
			return { step: 'error', photoId: null, view: event.view };
		case 'edit':
			return state.step === 'draft' ? { ...state, text: event.text } : state;
		case 'saved':
			return state.step === 'draft' ? { step: 'done' } : state;
		case 'discarded':
			return state.step === 'done' ? state : { step: 'done' };
	}
}

/**
 * The photo id the keepalive timer pings, or null when there is nothing to
 * keep alive. A string, so an effect depending on it does not re-run when
 * only the draft text changes.
 */
export function keepaliveTarget(state: PhotoState): string | null {
	if (state.step === 'draft' && state.expired) return null;
	if (state.step === 'done' || !('photoId' in state)) return null;
	return state.photoId;
}

/** The photo to delete when a transition ends the draft (saved or discarded). */
export function photoToDelete(prev: PhotoState, next: PhotoState): string | null {
	if (next.step !== 'done' || prev.step === 'done') return null;
	return 'photoId' in prev ? prev.photoId : null;
}

/** Over the server's 10 MiB cap, or not a type the server takes (for example HEIC). */
export function needsDownscale(file: { size: number; type: string }): boolean {
	if (file.size > MAX_UPLOAD_BYTES) return true;
	return !['image/jpeg', 'image/png', 'image/webp'].includes(file.type);
}

export function defaultEngine(aiAvailable: boolean): Engine {
	return aiAvailable ? 'ai' : 'offline';
}

/** Why offline reading cannot be used, or null when it can. */
export function offlineBlockReason(
	ocr: { available: boolean; languageReady: boolean },
	languageName: string
): string | null {
	if (!ocr.available) return 'Offline reading is not installed on this server';
	if (!ocr.languageReady) return `Offline reading has no model for ${languageName}`;
	return null;
}

/** Target size for a downscale: the long edge capped at `edge`, never enlarged. */
export function scaledSize(width: number, height: number, edge = DOWNSCALE_EDGE): { width: number; height: number } {
	const long = Math.max(width, height);
	if (long <= edge) return { width, height };
	const k = edge / long;
	return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}

/** The label of the offline button: "instead" only when the AI read just failed. */
export function offlineButtonLabel(input: {
	failedEngine: Engine | null;
	offlineInstead: boolean;
}): string {
	return input.failedEngine === 'ai' && input.offlineInstead ? 'Read offline instead' : 'Read offline';
}
