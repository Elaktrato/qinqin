// What Settings -> Account -> App shows, as pure data, and what its
// "Clear offline data" button deletes.

import { cleanupPartitions, type CachesLike } from './partitions';
import { formatBytes } from './install';
import { clearReceipts } from './prepareOffline';
import type { OfflineState } from './offlineState';

export interface AppViewInput {
	secure: boolean;
	standalone: boolean;
	ios: boolean;
	canPrompt: boolean;
	prepared: OfflineState['prepared'];
	usage: { usage: number; quota: number } | null;
}

export interface AppView {
	httpsNote: string | null;
	showInstall: boolean;
	installedNote: boolean;
	iosHint: boolean;
	offlineLine: string | null;
	storageLine: string | null;
	showClear: boolean;
}

function clock(iso: string): string {
	const at = new Date(iso);
	if (Number.isNaN(at.getTime())) return '';
	return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
}

export function appSectionView(i: AppViewInput): AppView {
	if (!i.secure) {
		return {
			httpsNote:
				'Installing and offline study need HTTPS (or localhost). This server is reached over plain HTTP, so qinqin works as an ordinary website here.',
			showInstall: false,
			installedNote: false,
			iosHint: false,
			offlineLine: null,
			storageLine: null,
			showClear: false
		};
	}
	return {
		httpsNote: null,
		showInstall: i.canPrompt && !i.standalone,
		installedNote: i.standalone,
		iosHint: i.ios && !i.standalone && !i.canPrompt,
		offlineLine:
			i.prepared === null
				? "Offline: not prepared yet. Open the app online and it saves today's cards."
				: `Offline: ready - ${i.prepared.cards} ${i.prepared.cards === 1 ? 'card' : 'cards'} saved at ${clock(i.prepared.at)}`,
		storageLine: i.usage === null ? null : `Storage used: ${formatBytes(i.usage.usage)} of ${formatBytes(i.usage.quota)}`,
		showClear: true
	};
}

/**
 * clearOfflineData deletes every saved API copy (all credentials) and the
 * "prepared" receipts. The review outbox is never touched: unsent reviews are
 * not a cache.
 */
export async function clearOfflineData(
	caches: CachesLike | undefined,
	storage: Pick<Storage, 'length' | 'key' | 'removeItem'> | null
): Promise<void> {
	await cleanupPartitions(caches, null);
	clearReceipts(storage);
}
