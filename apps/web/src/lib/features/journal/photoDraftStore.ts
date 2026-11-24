// A photo draft survives a reload in sessionStorage (not across tabs or
// browser restarts). The photo itself stays on the server until the
// janitor or the learner removes it.

const KEY = 'qinqin.journal.photoDraft';

export interface PhotoDraft {
	photoId: string;
	workspaceId: number;
	text: string;
	engine: string;
}

export function saveDraft(d: PhotoDraft): void {
	try {
		sessionStorage.setItem(KEY, JSON.stringify(d));
	} catch {
		// storage blocked: the draft just does not survive a reload
	}
}

export function loadDraft(
	workspaceId: number
): { photoId: string; text: string; engine: string } | null {
	try {
		const raw = sessionStorage.getItem(KEY);
		if (!raw) return null;
		const d = JSON.parse(raw) as Partial<PhotoDraft> | null;
		if (
			!d ||
			typeof d.photoId !== 'string' ||
			d.photoId === '' ||
			d.workspaceId !== workspaceId ||
			typeof d.text !== 'string' ||
			typeof d.engine !== 'string'
		) {
			return null;
		}
		return { photoId: d.photoId, text: d.text, engine: d.engine };
	} catch {
		return null;
	}
}

export function clearDraft(): void {
	try {
		sessionStorage.removeItem(KEY);
	} catch {
		// nothing to clear
	}
}
