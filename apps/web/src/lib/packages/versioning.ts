// The client rule of docs/contracts/packages/README.md ("Client rule"), as a
// pure function. The web installs no packages; this is the reference a
// native client is checked against (versioning.json `client` cases).
import type { CatalogueRow } from '../api/packages';

export type PackageAction = 'keep' | 'download' | 'delete' | 'wait' | 'unsupported' | 'reset';

export interface Installed {
	revision: number;
	contentHash: string;
	formatVersion: number;
}

/**
 * packageAction decides what a client does with one catalogue row. Order:
 * reset, deleted, pending, unknown format, nothing installed, differs, keep.
 * Revisions are compared for equality only (a server restored from an older
 * backup goes back in revision and still wins). `download` of an optional
 * package is asked of the user first; the rule stays `download`.
 */
export function packageAction(
	installed: Installed | null,
	row: Pick<CatalogueRow, 'state' | 'revision' | 'formatVersion' | 'contentHash'>,
	knownFormats: readonly number[],
	local: string | null,
	remote: string
): PackageAction {
	if (local !== null && local !== remote) return 'reset';
	if (row.state === 'deleted') return installed !== null ? 'delete' : 'keep';
	if (row.state === 'building' || row.state === 'failed') return installed !== null ? 'keep' : 'wait';
	if (!knownFormats.includes(row.formatVersion)) return 'unsupported';
	if (installed === null) return 'download';
	if (installed.revision !== row.revision || installed.contentHash !== row.contentHash || installed.formatVersion !== row.formatVersion) return 'download';
	return 'keep';
}
