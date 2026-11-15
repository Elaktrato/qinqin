// Pure data assembly for the Sources page: the pack tables' rows and
// notes from the API, the plugin credits from the web plugin manifests,
// and the app's own credits. The page only renders what this returns.

import type { SentencePack } from '$lib/api/packs';
import type { PluginManifest } from '$lib/plugins';
import { localLicensePath, type LicenseText, type SourceCredit } from './credits';
import { cjkLang, parseNotice, safeHref, type NoticeParagraph } from './notice';

/** The fields of a pack (dictionary, frequency list, level list) the page shows. */
export interface PackSource {
	id: number;
	name: string;
	language?: string;
	version?: string;
	license?: string;
	attribution?: string;
	notice?: string;
}

/** sentencePackSources adapts GET /api/sentence-packs rows (string ids) to PackSource. */
export function sentencePackSources(list: SentencePack[]): PackSource[] {
	return list.map((p, i) => ({
		id: i,
		name: p.name,
		language: p.language,
		version: p.version,
		license: p.license,
		attribution: p.attribution,
		notice: p.notice
	}));
}

export interface PackRow {
	key: number;
	name: string;
	language: string;
	version: string;
	license: string;
	attribution: string;
	/** The element id of this row's note, when the pack has a notice. */
	noteId?: string;
}

export interface PackNote {
	id: string;
	name: string;
	/** Language tag for the note's CJK runs. */
	lang: string;
	paragraphs: NoticeParagraph[];
	/**
	 * Earlier notes in the same table that hold paragraphs this note
	 * shares word for word; those paragraphs are shown there only.
	 */
	sharedWith: { id: string; name: string }[];
}

export interface PackTable {
	rows: PackRow[];
	notes: PackNote[];
}

/**
 * packTable builds a table's rows and its "Notes" block. `prefix` keeps
 * note ids unique across the page's tables (`note-levels-3`). A
 * paragraph identical to one in an earlier note of the same table (the
 * CTI terms both HSK packs carry) is shown only in the first note; the
 * later note points to it instead.
 */
export function packTable(prefix: string, packs: PackSource[]): PackTable {
	const rows: PackRow[] = [];
	const notes: PackNote[] = [];
	const seen = new Map<string, { id: string; name: string }>();
	for (const pack of packs) {
		const all = parseNotice(pack.notice);
		const noteId = all.length > 0 ? `note-${prefix}-${pack.id}` : undefined;
		const paragraphs: NoticeParagraph[] = [];
		const sharedWith: { id: string; name: string }[] = [];
		for (const paragraph of all) {
			const key = JSON.stringify(paragraph.parts);
			const first = seen.get(key);
			// A paragraph this note itself repeats is shown as written.
			if (first && first.id !== noteId) {
				if (!sharedWith.some((note) => note.id === first.id)) sharedWith.push(first);
			} else {
				paragraphs.push(paragraph);
				if (noteId && !first) seen.set(key, { id: noteId, name: pack.name });
			}
		}
		rows.push({
			key: pack.id,
			name: pack.name,
			language: pack.language ?? '',
			version: pack.version ?? '',
			license: pack.license ?? '',
			attribution: pack.attribution ?? '',
			noteId
		});
		if (noteId) {
			notes.push({
				id: noteId,
				name: pack.name,
				lang: cjkLang(pack.notice ?? '', pack.language),
				paragraphs,
				sharedWith
			});
		}
	}
	return { rows, notes };
}

export interface CreditView {
	name: string;
	/** The upstream page, only when it is an https URL. */
	href?: string;
	license: string;
	attribution: string;
	lang: string;
	paragraphs: NoticeParagraph[];
	/** Licence texts served by the app, only root-relative static files. */
	licenseTexts: LicenseText[];
}

/** creditView prepares one credit for rendering, dropping unsafe links. */
export function creditView(credit: SourceCredit): CreditView {
	return {
		name: credit.name,
		href: credit.url ? (safeHref(credit.url) ?? undefined) : undefined,
		license: credit.license ?? '',
		attribution: credit.attribution ?? '',
		lang: cjkLang(credit.notice ?? '', credit.lang),
		paragraphs: parseNotice(credit.notice),
		licenseTexts: (credit.licenseTexts ?? []).filter(
			(text) => text.label.trim() !== '' && localLicensePath(text.path) !== null
		)
	};
}

export interface PluginCredits {
	id: string;
	name: string;
	credits: CreditView[];
}

/**
 * pluginCredits lists, in registry order, each plugin that declares
 * sources with its credits. A credit already listed under the app's own
 * credits (same name, case-insensitive) is left out, so shared material
 * appears once; a plugin left with no credits is skipped.
 */
export function pluginCredits(
	manifests: PluginManifest[],
	core: SourceCredit[] = []
): PluginCredits[] {
	const coreNames = new Set(core.map((credit) => credit.name.trim().toLowerCase()));
	return manifests.flatMap((manifest) => {
		const credits = (manifest.sources ?? [])
			.filter((credit) => !coreNames.has(credit.name.trim().toLowerCase()))
			.map(creditView);
		return credits.length > 0 ? [{ id: manifest.id, name: manifest.name, credits }] : [];
	});
}
