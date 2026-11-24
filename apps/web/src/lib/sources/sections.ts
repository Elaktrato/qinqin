// Pure data assembly for the Sources page: the pack tables' rows and
// notes from the API, the feature credits from the core features (lib/features),
// and the app's own credits. The page only renders what this returns.

import type { SentencePack } from '$lib/api/packs';
import type { ThemePack } from '$lib/api/themes';
import type { ComponentPack, LemmaPack, StrokePack } from '$lib/api/types';
import type { FontList } from '$lib/api/fonts';
import { t } from '$lib/i18n';
import { licenseUrl } from '$lib/sources/licenses';
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

/**
 * componentsSection is the Sources page's "Character components" block: the
 * table of GET /api/component-packs. It shows only while a pack is installed,
 * or on a load error (so the retry is reachable).
 */
export function componentsSection(list: ComponentPack[], error: string): { show: boolean; table: PackTable } {
	const table = packTable(
		'components',
		list.map((p, i) => ({
			id: i,
			name: p.name,
			language: p.language,
			version: p.version,
			license: p.license,
			attribution: p.attribution,
			notice: p.notice
		}))
	);
	return { show: error !== '' || list.length > 0, table };
}

/**
 * lemmaSection is the Sources page's "Lemmatizer rules" block: the table of
 * GET /api/lemma-packs. It shows only while a pack is installed, or on a load
 * error (so the retry is reachable).
 */
export function lemmaSection(list: LemmaPack[], error: string): { show: boolean; table: PackTable } {
	const table = packTable(
		'lemma',
		list.map((p, i) => ({
			id: i,
			name: p.name,
			language: p.language,
			version: p.version,
			license: p.license,
			attribution: p.attribution,
			notice: p.notice
		}))
	);
	return { show: error !== '' || list.length > 0, table };
}

/** Where the Arphic Public License text ships in apps/web/static (the stroke data's licence). */
const ARPHIC_TEXT = '/ARPHICPL.TXT';

/**
 * strokesSection is the Sources page's "Stroke data" block: the table of GET
 * /api/stroke-packs, with the licence text link for the Arphic Public License.
 * It shows only while a pack is installed, or on a load error.
 */
export function strokesSection(
	list: StrokePack[],
	error: string
): { show: boolean; table: PackTable; licenseHref: Record<number, string> } {
	const table = packTable(
		'strokes',
		list.map((p, i) => ({
			id: i,
			name: p.name,
			language: p.languages[0] ?? '',
			version: p.version,
			license: p.license,
			attribution: p.attribution,
			notice: p.notice
		}))
	);
	const licenseHref: Record<number, string> = {};
	list.forEach((p, i) => {
		if (/arphic public license/i.test(p.license) && localLicensePath(ARPHIC_TEXT) !== null) licenseHref[i] = ARPHIC_TEXT;
	});
	return { show: error !== '' || list.length > 0, table, licenseHref };
}

/**
 * themesSection is the Sources page's "Themes" block: every theme pack of GET
 * /api/themes (built-in packs first, as the answer orders them) with the
 * names of its themes and whether it is built into the app. It shows while a
 * pack is listed (the built-ins always are), or on a load error.
 */
export function themesSection(
	answer: { themes: readonly { id: string; name: string }[]; packs: readonly ThemePack[] },
	error: string
): {
	show: boolean;
	table: PackTable;
	themeNames: Record<number, string>;
	builtin: Record<number, boolean>;
	licenseTexts: { key: number; label: string; text: string }[];
} {
	const names = new Map(answer.themes.map((th) => [th.id, th.name]));
	const table = packTable(
		'themes',
		answer.packs.map((p, i) => ({
			id: i,
			name: p.name,
			version: p.version,
			license: p.license,
			attribution: p.attribution,
			notice: p.notice
		}))
	);
	const themeNames: Record<number, string> = {};
	const builtin: Record<number, boolean> = {};
	answer.packs.forEach((p, i) => {
		themeNames[i] = p.themes
			.map((id) => names.get(id))
			.filter((n): n is string => n !== undefined)
			.join(', ');
		builtin[i] = p.builtin;
	});
	const licenseTexts = answer.packs.flatMap((p, i) =>
		p.licenseText === ''
			? []
			: [{ key: i, label: t('sources.themes.licenseText', { name: p.name, license: p.license }), text: p.licenseText }]
	);
	return { show: error !== '' || answer.packs.length > 0, table, themeNames, builtin, licenseTexts };
}

/**
 * fontsSection is the Sources page's "Fonts" block: one row per installed
 * font pack from GET /api/fonts (licence linked when known), its notice,
 * and a line naming the face each pack modifies (the slices are renamed
 * modified versions under the OFL). Shown while a pack is installed, or on
 * a load error.
 */
export function fontsSection(
	list: FontList,
	error: string
): { show: boolean; table: PackTable; licenseHref: Record<number, string>; modified: string[] } {
	const language = (packId: string) => {
		const scripts = list.faces.filter((f) => f.packId === packId).map((f) => f.script);
		if (scripts.length === 0) return '';
		return scripts.every((s) => s === 'Jpan') ? 'ja' : scripts.every((s) => s !== 'Jpan') ? 'zh' : '';
	};
	const table = packTable(
		'fonts',
		list.packs.map((p, i) => ({
			id: i,
			name: p.name,
			language: language(p.packId),
			version: p.version,
			license: p.license,
			attribution: p.attribution,
			notice: p.notice
		}))
	);
	const licenseHref: Record<number, string> = {};
	const modified: string[] = [];
	list.packs.forEach((p, i) => {
		const href = licenseUrl(p.license);
		if (href) licenseHref[i] = href;
		const originals = [...new Set(list.faces.filter((f) => f.packId === p.packId).map((f) => f.original))];
		if (originals.length > 0) modified.push(t('sources.fonts.modified', { name: p.name, original: originals.join(', ') }));
	});
	return { show: error !== '' || list.packs.length > 0, table, licenseHref, modified };
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

export interface FeatureCredits {
	id: string;
	name: string;
	credits: CreditView[];
}

/**
 * featureCredits lists, in the features' order, each core feature that
 * declares sources with its credits. A credit already listed under the app's
 * own credits (same name, case-insensitive) is left out, so shared material
 * appears once; a feature left with no credits is skipped.
 */
export function featureCredits(
	features: readonly { id: string; title: string; def: { sources?: SourceCredit[] } }[],
	core: SourceCredit[] = []
): FeatureCredits[] {
	const coreNames = new Set(core.map((credit) => credit.name.trim().toLowerCase()));
	return features.flatMap((feature) => {
		const credits = (feature.def.sources ?? [])
			.filter((credit) => !coreNames.has(credit.name.trim().toLowerCase()))
			.map(creditView);
		return credits.length > 0 ? [{ id: feature.id, name: feature.title, credits }] : [];
	});
}
