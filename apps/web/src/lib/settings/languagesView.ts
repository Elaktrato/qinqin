import { ApiError } from '$lib/api/client';
import { t } from '$lib/i18n';
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

/** The counts of a 409 language_in_use that mean "installed packs" (docs/contracts/auth/errors.json). */
const PACK_COUNTS = ['dictionaries', 'levelLists', 'frequencyPacks', 'sentencePacks', 'grammarPacks', 'audioPacks', 'legacySentences'];

/**
 * inUseLines are the lines under a refused language removal: how many workspaces and installed packs still use
 * the language, from the `usage` counts of a 409 `language_in_use`. Empty for any other error or unreadable counts.
 */
export function inUseLines(err: unknown): string[] {
	if (!(err instanceof ApiError) || err.code !== 'language_in_use') return [];
	const usage = err.body?.usage;
	if (typeof usage !== 'object' || usage === null) return [];
	const counts = usage as Record<string, unknown>;
	if (Object.values(counts).some((v) => typeof v !== 'number')) return [];
	const n = (k: string): number => (typeof counts[k] === 'number' ? (counts[k] as number) : 0);
	const packs = PACK_COUNTS.reduce((sum, k) => sum + n(k), 0);
	const lines: string[] = [];
	if (n('workspaces') > 0) lines.push(t('settings.languages.inUseWorkspaces', { count: n('workspaces') }));
	if (packs > 0) lines.push(t('settings.languages.inUsePacks', { count: packs }));
	return lines;
}
