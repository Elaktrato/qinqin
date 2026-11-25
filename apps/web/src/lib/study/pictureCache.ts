// The pictures of the cards in a session (#214, #215, #216): one request per entry, kept for the session,
// and never an error on the card: a picture is a help, so a failure is "no picture" and is asked again later.

import { entryPicture, type EntryPicture } from '../api/images';

export class PictureCache {
	#done = new Map<number, EntryPicture | null>();
	#pending = new Map<number, Promise<EntryPicture | null>>();
	#fetch: (entryId: number) => Promise<EntryPicture | null>;
	#limit: number;

	constructor(fetch: (entryId: number) => Promise<EntryPicture | null> = (id) => entryPicture(id), limit = 200) {
		this.#fetch = fetch;
		this.#limit = limit;
	}

	/** The answer already known: a picture, null (none maps the entry) or undefined (not asked yet). */
	peek(entryId: number): EntryPicture | null | undefined {
		return this.#done.get(entryId);
	}

	/** load asks the server once per entry; a failure answers null and is not remembered. */
	load(entryId: number): Promise<EntryPicture | null> {
		if (this.#done.has(entryId)) return Promise.resolve(this.#done.get(entryId) ?? null);
		const running = this.#pending.get(entryId);
		if (running !== undefined) return running;
		const request = this.#fetch(entryId).then(
			(picture) => {
				this.#pending.delete(entryId);
				this.#done.set(entryId, picture);
				if (this.#done.size > this.#limit) {
					const oldest = this.#done.keys().next().value;
					if (oldest !== undefined) this.#done.delete(oldest);
				}
				return picture;
			},
			() => {
				this.#pending.delete(entryId);
				return null;
			}
		);
		this.#pending.set(entryId, request);
		return request;
	}
}
