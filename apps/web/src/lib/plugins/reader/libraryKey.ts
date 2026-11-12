/** Composite key for a source work; ids alone can collide across sources. */
export function libraryKey(source: string, sourceId: string): string {
	return `${source}:${sourceId}`;
}
