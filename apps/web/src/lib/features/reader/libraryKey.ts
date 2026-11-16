/**
 * Composite key for a source work in one workspace's library: ids alone
 * can collide across sources, and each workspace has its own library.
 */
export function libraryKey(workspaceId: number, source: string, sourceId: string): string {
	return `${workspaceId}:${source}:${sourceId}`;
}
