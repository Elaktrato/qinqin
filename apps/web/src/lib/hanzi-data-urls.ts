// Character → emitted asset URL for the offline stroke data package.
//
// The map is ~9.6k entries, so it deliberately lives in its own module:
// the stroke player imports this lazily and only for a character entry,
// keeping the map out of every other route bundle.
const charUrls: Record<string, string | undefined> = import.meta.glob(
	'/node_modules/hanzi-writer-data/*.json',
	{ query: '?url&no-inline', import: 'default', eager: true }
);

// Returns undefined for characters the data package does not cover.
export function hanziDataUrl(char: string): string | undefined {
	return charUrls[`/node_modules/hanzi-writer-data/${char}.json`];
}
