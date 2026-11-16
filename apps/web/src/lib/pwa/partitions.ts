// Page-side cleanup of the service worker's API cache partitions. The worker
// cannot read localStorage; the page knows when a session starts, switches or
// ends and removes every partition that is not the current credential's.

import { API_CACHE_FAMILY, partitionName } from './sw/partition';

export interface CachesLike {
	keys(): Promise<string[]>;
	delete(name: string): Promise<boolean>;
}

/** ownPartition: the partition name of the stored bearer token. */
export function ownPartition(token: string): Promise<string> {
	return partitionName(`Bearer ${token}`);
}

/**
 * cleanupPartitions deletes every API partition (any generation) except
 * `keep`; null keeps none (sign-out). Shell and stroke caches are not user
 * data and stay. Without Cache Storage (plain HTTP) or on any failure it does
 * nothing: cleanup must never break signing in or out.
 */
export async function cleanupPartitions(
	cachesLike: CachesLike | undefined = typeof caches === 'undefined' ? undefined : caches,
	keep: string | null
): Promise<void> {
	if (cachesLike === undefined) return;
	try {
		for (const name of await cachesLike.keys()) {
			if (name.startsWith(API_CACHE_FAMILY) && name !== keep) await cachesLike.delete(name);
		}
	} catch {
		// Best effort.
	}
}
