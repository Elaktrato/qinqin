import type { InstalledPack } from '$lib/api/packs';
import type { Language } from '$lib/api/types';
import { languageLabel } from '$lib/languages';
import { PACK_TYPE_LABELS } from './packsView';

const CODE = /^[a-z]{2,3}(-[a-z0-9]{2,8}){0,2}$/;

/** normalizeCode mirrors the server: trim, lowercase, `_` to `-`, then the code pattern. */
export function normalizeCode(raw: string): string | null {
	const code = raw.trim().toLowerCase().replace(/_/g, '-');
	return CODE.test(code) ? code : null;
}

export interface LanguageRow {
	code: string;
	label: string;
	kind: 'code' | 'data';
	/** False for a stored code that fails the pattern (legacy rows). */
	valid: boolean;
	packs: string[];
	workspaces: number;
	removable: boolean;
}

/**
 * languageRows joins the known languages with the packs that provide
 * them and the workspace counts. Removable: a data-only language with
 * no packs, no workspaces and no installed dictionary data.
 */
export function languageRows(
	langs: readonly Language[],
	packs: readonly InstalledPack[],
	usage: readonly { code: string; workspaces: number }[]
): LanguageRow[] {
	return langs.map((l) => {
		const key = l.code.toLowerCase();
		const own = packs
			.filter((p) => p.language.toLowerCase() === key)
			.map((p) => `${p.name || p.packId} (${PACK_TYPE_LABELS[p.type]})`);
		const workspaces = usage.find((u) => u.code.toLowerCase() === key)?.workspaces ?? 0;
		return {
			code: l.code,
			label: languageLabel(l.code),
			kind: l.kind,
			valid: CODE.test(l.code),
			packs: own,
			workspaces,
			removable: l.kind === 'data' && own.length === 0 && workspaces === 0 && !l.installed
		};
	});
}
