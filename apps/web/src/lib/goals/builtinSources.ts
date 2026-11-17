// The activity sources of the built-in plugin manifests, in the shape the
// activity route lists them: the fallback choices for Settings when the
// route cannot be reached (offline).

import core from '$builtin/core.json';
import journal from '$builtin/journal.json';
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

// review and read are the core's (v0.4.0: flashcards and the reader are core
// features), journal the journal plugin's: the route's order.
export const BUILTIN_SOURCES: readonly ActivitySource[] = [core, journal].flatMap((m) =>
	sourcesOf(m as ContractManifest)
);
