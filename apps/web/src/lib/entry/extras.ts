import type { EntryBase } from '$lib/api/types';

/** The entry page's optional sections: characters under a radical, the radical's written form. */
export interface EntryExtras {
	chars: EntryBase[];
	radicalWritten: string;
}

export interface ExtrasDeps {
	/** GET /api/entries/{id}/chars */
	chars: (id: number) => Promise<EntryBase[]>;
	/** GET /api/entries/{id} (only the written form is used) */
	entry: (id: number) => Promise<{ written: string }>;
}

/**
 * loadEntryExtras loads the optional sections of an entry page (#17). Each
 * request settles on its own (allSettled): a failure empties only its
 * section, never the page. Words have no characters under them, so they
 * never ask /chars (the query would always be empty). A radical that is
 * its own radical (人) names itself without fetching itself again.
 */
export async function loadEntryExtras(
	entry: { id: number; kind: string; radicalId: number | null; written?: string },
	deps: ExtrasDeps
): Promise<EntryExtras> {
	const [under, radical] = await Promise.allSettled([
		entry.kind === 'word' ? Promise.resolve<EntryBase[]>([]) : deps.chars(entry.id),
		entry.radicalId === null
			? Promise.resolve('')
			: entry.radicalId === entry.id && entry.written
				? Promise.resolve(entry.written)
				: deps.entry(entry.radicalId).then((r) => r.written)
	]);
	return {
		chars: under.status === 'fulfilled' ? under.value : [],
		radicalWritten: radical.status === 'fulfilled' ? radical.value : ''
	};
}
