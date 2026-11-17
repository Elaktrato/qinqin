// The words of a plugin manifest as the interface shows them (issue #73, spec "Plugin manifests"). The built-in
// manifests (server/internal/plugins/builtin/*.json) are English; for a built-in id the catalogue's
// `plugin.<idCamel>.*` text is shown instead, so a translation covers them too. A third-party manifest's own text is
// shown verbatim: the app cannot translate what it does not ship.
import { t, type MessageKey } from '$lib/i18n';

interface BuiltinKeys {
	name: MessageKey;
	description: MessageKey;
	/** Per activity type: its label and its count text (`{count, plural, …}` with `{n}`). */
	activities: Readonly<Record<string, { label: MessageKey; count: MessageKey }>>;
}

const BUILTIN: Readonly<Record<string, BuiltinKeys>> = {
	'qinqin-core': {
		name: 'plugin.qinqinCore.name',
		description: 'plugin.qinqinCore.description',
		activities: {
			review: { label: 'plugin.qinqinCore.activity.review.label', count: 'plugin.qinqinCore.activity.review.count' },
			read: { label: 'plugin.qinqinCore.activity.read.label', count: 'plugin.qinqinCore.activity.read.count' }
		}
	},
	'qinqin-flashcards': {
		name: 'plugin.qinqinFlashcards.name',
		description: 'plugin.qinqinFlashcards.description',
		activities: {}
	},
	'qinqin-grammar': {
		name: 'plugin.qinqinGrammar.name',
		description: 'plugin.qinqinGrammar.description',
		activities: {}
	},
	'qinqin-journal': {
		name: 'plugin.qinqinJournal.name',
		description: 'plugin.qinqinJournal.description',
		activities: {
			journal: { label: 'plugin.qinqinJournal.activity.journal.label', count: 'plugin.qinqinJournal.activity.journal.count' }
		}
	},
	'qinqin-reader': {
		name: 'plugin.qinqinReader.name',
		description: 'plugin.qinqinReader.description',
		activities: {}
	}
};

/** The catalogue keys of a built-in manifest, or null for a third-party id. */
export function builtinKeys(id: string): BuiltinKeys | null {
	return Object.hasOwn(BUILTIN, id) ? BUILTIN[id] : null;
}

/** A plugin's name: the catalogue's for a built-in id, else the manifest's. */
export function pluginName(manifest: { id: string; name: string }): string {
	const keys = builtinKeys(manifest.id);
	return keys === null ? manifest.name : t(keys.name);
}

/** A plugin's description ('' when it has none). */
export function pluginDescription(manifest: { id: string; description?: string }): string {
	const keys = builtinKeys(manifest.id);
	return keys === null ? (manifest.description ?? '') : t(keys.description);
}

type Source = { plugin: string; type: string };

function activityKeys(source: Source): { label: MessageKey; count: MessageKey } | null {
	const keys = builtinKeys(source.plugin);
	return keys !== null && Object.hasOwn(keys.activities, source.type) ? keys.activities[source.type] : null;
}

/** An activity source's label ("Flashcard reviews"). */
export function activityLabel(source: Source & { label: string }): string {
	const keys = activityKeys(source);
	return keys === null ? source.label : t(keys.label);
}

/**
 * An amount of an activity ("32 of 50 flashcard reviews"): `n` is the text put in for `{n}`, `count` the number the
 * plural follows. A third-party source uses its own `describe` templates (`one` for exactly 1).
 */
export function activityText(source: Source & { describe: { one: string; other: string } }, count: number, n: string): string {
	const keys = activityKeys(source);
	if (keys !== null) return t(keys.count, { count, n });
	return (count === 1 ? source.describe.one : source.describe.other).replaceAll('{n}', n);
}
