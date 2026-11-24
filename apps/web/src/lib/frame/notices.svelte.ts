// One short, non-modal notice for the app shell: something the user should
// know but need not act on, such as "this workspace was deleted in another
// tab". The layout shows it in a polite live region with a dismiss button; a
// newer notice replaces an older one. Owned by the session (record 0009): a
// notice may name the user's data, so it ends with the session.

export class Notices {
	#text = $state<string | null>(null);

	get text(): string | null {
		return this.#text;
	}

	show(text: string): void {
		this.#text = text;
	}

	dismiss(): void {
		this.#text = null;
	}
}
