// One short, non-modal notice for the app shell: something the user
// should know but need not act on, such as "this workspace was deleted
// in another tab". The layout shows it in a polite live region with a
// dismiss button; a newer notice replaces an older one.

import { writable } from 'svelte/store';

export const notice = writable<string | null>(null);

export function showNotice(text: string): void {
	notice.set(text);
}

export function dismissNotice(): void {
	notice.set(null);
}
