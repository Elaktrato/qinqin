// Pure view helpers of the Data tab's pack manager. The wording is
// deliberate: a licence is only ever shown "as stated by the pack", and
// nothing here says or hints that a licence was checked or is fine.

import type { InstalledPack, PackType, StagedPack } from '$lib/api/packs';
import type { CatalogueRow } from '$lib/api/packages';
import type { UploadProgress } from '$lib/api/upload';
import { labelRecord, t, type MessageKey } from '$lib/i18n';
import { formatNumber } from '$lib/i18n/format';

/** The heading over a pack's licence. */
export function licenceLabel(): string {
	return t('packs.licence.label');
}
export function licenceNotRecorded(): string {
	return t('packs.licence.notRecorded');
}
export function licenceConfirmation(): string {
	return t('packs.licence.confirmation');
}
export function licenceCautionText(): string {
	return t('packs.licence.caution');
}

export const PACK_TYPE_LABELS: Readonly<Record<PackType, string>> = labelRecord({
	dictionary: 'packs.type.dictionary',
	frequency: 'packs.type.frequency',
	levels: 'packs.type.levels',
	sentences: 'packs.type.sentences',
	grammar: 'packs.type.grammar',
	audio: 'packs.type.audio',
	components: 'packs.type.components',
	strokes: 'packs.type.strokes'
});

const TYPE_ORDER: PackType[] = ['dictionary', 'frequency', 'levels', 'sentences', 'grammar', 'audio', 'components', 'strokes'];

/** packLanguages is the languages a listed pack covers: a strokes pack's list, else its one language. */
export function packLanguages(pack: InstalledPack): string[] {
	if (pack.languages && pack.languages.length > 0) return pack.languages;
	return pack.language ? [pack.language] : [];
}

/** groupPacks groups the server's list (already ordered) by type; empty groups are dropped. */
export function groupPacks(list: InstalledPack[]): { type: PackType; label: string; packs: InstalledPack[] }[] {
	return TYPE_ORDER.map((type) => ({
		type,
		label: PACK_TYPE_LABELS[type],
		packs: list.filter((p) => p.type === type)
	})).filter((g) => g.packs.length > 0);
}

/** licenceLine is the licence exactly as stored, or the not-recorded notice. */
export function licenceLine(license: string): { text: string; recorded: boolean } {
	return license.trim() === '' ? { text: licenceNotRecorded(), recorded: false } : { text: license, recorded: true };
}

// Words in a licence string that suggest restricted use. A heuristic: it
// can miss restrictive terms written in other words, and it never marks
// anything as acceptable.
const RESTRICTIVE =
	/\b(unknown|unclear|unspecified|proprietary|all rights reserved|non-?commercial|nc|research|no redistribution)\b/i;

/** licenceCaution is the advisory line for a licence that may restrict use, else null. */
export function licenceCaution(license: string): string | null {
	return RESTRICTIVE.test(license) ? licenceCautionText() : null;
}

/** replaceLines describes what installing the staged pack replaces. */
export function replaceLines(staged: StagedPack): { text: string; licenceChanged: boolean }[] {
	const old = staged.replaces;
	if (!old) return [];
	const m = staged.manifest;
	const lines = [{ text: t('packs.replace.version', { old: old.version, new: m.version }), licenceChanged: false }];
	if (old.license.trim() === '') {
		lines.push({ text: t('packs.replace.licenceNew', { licence: m.license }), licenceChanged: true });
	} else if (old.license !== m.license) {
		lines.push({ text: t('packs.replace.licenceChanged', { old: old.license, new: m.license }), licenceChanged: true });
	} else {
		lines.push({ text: t('packs.replace.licenceSame', { licence: m.license }), licenceChanged: false });
	}
	if (old.attribution !== m.attribution) {
		lines.push({
			text: t('packs.replace.attribution', { old: old.attribution, new: m.attribution }),
			licenceChanged: false
		});
	}
	return lines;
}

/** progressText formats an upload's progress, e.g. "3.2 of 10.6 MB (30 %)". */
export function progressText(p: UploadProgress): string {
	if (p.total <= 0) return t('packs.progress.bytes', { count: p.loaded });
	const mb = p.total >= 1024 * 1024;
	const unit = mb ? 1024 * 1024 : 1024;
	const fmt = (n: number) => formatNumber(n / unit, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
	const args = { loaded: fmt(p.loaded), total: fmt(p.total), percent: Math.min(100, Math.floor((p.loaded / p.total) * 100)) };
	return mb ? t('packs.progress.mb', args) : t('packs.progress.kb', args);
}

const UNINSTALL: Record<PackType, MessageKey> = {
	dictionary: 'packs.uninstall.dictionary',
	frequency: 'packs.uninstall.frequency',
	levels: 'packs.uninstall.levels',
	sentences: 'packs.uninstall.sentences',
	grammar: 'packs.uninstall.grammar',
	components: 'packs.uninstall.components',
	strokes: 'packs.uninstall.strokes',
	audio: 'packs.uninstall.audio'
};

/** uninstallWarning says what an uninstall removes and what stays. */
export function uninstallWarning(type: PackType): string {
	return t(UNINSTALL[type]);
}

export function packagesBuilding(): string {
	return t('packs.packages.building');
}
export function packagesUnavailable(): string {
	return t('packs.packages.unavailable');
}

/**
 * packagesOf lists the live packages the server built from an installed pack:
 * a package names its source packs, a lexicon several of them. Tombstones
 * (uninstalled packages) are left out.
 */
export function packagesOf(pack: InstalledPack, rows: readonly CatalogueRow[]): CatalogueRow[] {
	return rows.filter((r) => r.state !== 'deleted' && r.sources.some((s) => s.packId === pack.packId));
}

/**
 * packageLine describes one package for the pack list: revision, size in MB
 * and state, or that its first build is pending or failed. `error` is the
 * build error text an administrator's catalogue carries.
 */
export function packageLine(row: CatalogueRow): { text: string; error: string | null } {
	const error = row.error ?? null;
	switch (row.state) {
		case 'ready':
			return {
				text: t('packs.package.ready', {
					id: row.id,
					revision: row.revision,
					mb: formatNumber(row.bytes / (1024 * 1024), { minimumFractionDigits: 1, maximumFractionDigits: 1 })
				}),
				error
			};
		case 'building':
			return { text: t('packs.package.building', { id: row.id }), error };
		case 'failed':
			return { text: t('packs.package.failed', { id: row.id }), error };
		default:
			return { text: t('packs.package.removed', { id: row.id }), error };
	}
}
