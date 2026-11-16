// Pure view helpers of the Data tab's pack manager. The wording is
// deliberate: a licence is only ever shown "as stated by the pack", and
// nothing here says or hints that a licence was checked or is fine.

import type { InstalledPack, PackType, StagedPack } from '$lib/api/packs';
import type { UploadProgress } from '$lib/api/upload';

export const LICENCE_LABEL = 'Licence (as stated by the pack)';
export const LICENCE_NOT_RECORDED = 'Licence not recorded — reinstall the pack to record it';
export const LICENCE_CONFIRMATION =
	'I have read the licence and attribution above and this server may use the data under these terms';
export const LICENCE_CAUTION = 'This licence may restrict use or redistribution — check it before installing';

export const PACK_TYPE_LABELS: Record<PackType, string> = {
	dictionary: 'Dictionaries',
	frequency: 'Frequency lists',
	levels: 'Level lists',
	sentences: 'Sentences',
	grammar: 'Grammar lessons',
	audio: 'Audio',
	components: 'Character components'
};

const TYPE_ORDER: PackType[] = ['dictionary', 'frequency', 'levels', 'sentences', 'grammar', 'audio', 'components'];

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
	return license.trim() === '' ? { text: LICENCE_NOT_RECORDED, recorded: false } : { text: license, recorded: true };
}

// Words in a licence string that suggest restricted use. A heuristic: it
// can miss restrictive terms written in other words, and it never marks
// anything as acceptable.
const RESTRICTIVE =
	/\b(unknown|unclear|unspecified|proprietary|all rights reserved|non-?commercial|nc|research|no redistribution)\b/i;

/** licenceCaution is the advisory line for a licence that may restrict use, else null. */
export function licenceCaution(license: string): string | null {
	return RESTRICTIVE.test(license) ? LICENCE_CAUTION : null;
}

/** replaceLines describes what installing the staged pack replaces. */
export function replaceLines(staged: StagedPack): { text: string; licenceChanged: boolean }[] {
	const old = staged.replaces;
	if (!old) return [];
	const m = staged.manifest;
	const lines = [{ text: `Replaces the installed version ${old.version} with ${m.version}`, licenceChanged: false }];
	if (old.license.trim() === '') {
		lines.push({ text: `Licence was not recorded; now ${m.license}`, licenceChanged: true });
	} else if (old.license !== m.license) {
		lines.push({ text: `Licence changes from ${old.license} to ${m.license}`, licenceChanged: true });
	} else {
		lines.push({ text: `Licence stays ${m.license}`, licenceChanged: false });
	}
	if (old.attribution !== m.attribution) {
		lines.push({
			text: `Attribution changes from "${old.attribution}" to "${m.attribution}"`,
			licenceChanged: false
		});
	}
	return lines;
}

/** progressText formats an upload's progress, e.g. "3.2 of 10.6 MB (30 %)". */
export function progressText(p: UploadProgress): string {
	if (p.total <= 0) return `${p.loaded} bytes`;
	const mb = p.total >= 1024 * 1024;
	const unit = mb ? 1024 * 1024 : 1024;
	const fmt = (n: number) => (n / unit).toFixed(1);
	const pct = Math.min(100, Math.floor((p.loaded / p.total) * 100));
	return `${fmt(p.loaded)} of ${fmt(p.total)} ${mb ? 'MB' : 'KB'} (${pct} %)`;
}

const RESEED = 'A later `qinqin seed` reinstalls bundled packs.';

/** uninstallWarning says what an uninstall removes and what stays. */
export function uninstallWarning(type: PackType): string {
	switch (type) {
		case 'dictionary':
			return `Its glosses disappear from lookups and entries. Entries, your flashcards and your edits stay. ${RESEED}`;
		case 'frequency':
			return `Its frequency ranks disappear from lookups and sorting. Entries stay. ${RESEED}`;
		case 'levels':
			return `Its levels disappear from level filters and the mastery map. Entries and your study data stay. ${RESEED}`;
		case 'sentences':
			return `Its example sentences disappear. Sentences you added yourself stay. ${RESEED}`;
		case 'grammar':
			return `Its grammar lessons disappear. ${RESEED}`;
		case 'components':
			return `Its character components disappear from the radical and part lookup; radicals and stroke counts keep working. ${RESEED}`;
		case 'audio':
			return `Its recordings are deleted from the data directory and the play buttons that used them fall back to the device voice. Install it again with the fetch script and \`qinqin seed\`; audio packs cannot be uploaded here.`;
	}
}
