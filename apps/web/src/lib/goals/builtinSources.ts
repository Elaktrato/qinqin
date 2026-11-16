// The activity sources of the built-in plugin manifests, in the shape the
// activity route lists them: the fallback choices for Settings when the
// route cannot be reached (offline).

import flashcards from '$builtin/flashcards.json';
import journal from '$builtin/journal.json';
import reader from '$builtin/reader.json';
import type { ActivitySource } from '../api/stats';
import type { ContractManifest } from '../plugins/contract';

function sourcesOf(manifest: ContractManifest): ActivitySource[] {
	return manifest.events.flatMap((event) =>
		event.activity === undefined
			? []
			: [
					{
						type: event.type,
						plugin: manifest.id,
						label: event.activity.label,
						unit: event.activity.measure?.unit === 'seconds' ? ('seconds' as const) : ('count' as const),
						describe: event.activity.describe
					}
				]
	);
}

export const BUILTIN_SOURCES: readonly ActivitySource[] = [flashcards, journal, reader].flatMap((m) =>
	sourcesOf(m as ContractManifest)
);
