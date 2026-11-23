// The row decoders of the paged pull (docs/contracts/sync/README.md, "Reading
// rows"): the pager checks a page's envelope only, and each consumer decodes
// the rows it uses with readableRow. A row that does not decode is
// unreadable: the consumer skips it (and reports it), never the whole page.
// Typed study rows decode strictly as docs/contracts/study/rows.json.
import { parseRow, STUDY_COLLECTIONS, type StudyCollection } from '../study/rows';

const TIME = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/;

/** The row shapes of pull-page.json `shapes` (every key always present). */
const SHAPES: Record<string, readonly string[]> = {
	workspaces: ['id', 'language', 'name', 'settings', 'updatedAt'],
	pluginStates: ['pluginId', 'userId', 'enabled', 'order', 'updatedAt'],
	pluginData: ['pluginId', 'key', 'userId', 'workspaceId', 'data', 'version', 'updatedAt', 'deletedAt'],
	books: ['id', 'workspaceId', 'language', 'title', 'author', 'source', 'sourceId', 'sourceUrl', 'attribution', 'licenseNote', 'chapterCount', 'position', 'createdAt', 'updatedAt', 'deletedAt'],
	bookmarks: ['id', 'bookId', 'position', 'label', 'createdAt', 'updatedAt', 'deletedAt'],
	highlights: ['id', 'bookId', 'chapter', 'paragraph', 'start', 'end', 'text', 'color', 'note', 'createdAt', 'updatedAt', 'deletedAt'],
	overlays: ['entryId', 'written', 'readings', 'updatedAt'],
	sentences: ['id', 'entryId', 'sourcePack', 'userId', 'hanzi', 'pinyin', 'translation', 'updatedAt', 'deletedAt'],
	events: ['id', 'workspaceId', 'device', 'ts', 'type', 'payload', 'updatedAt']
};
const LIBRARY = new Set(['books', 'bookmarks', 'highlights']);
const LIBRARY_TOMBSTONE = ['id', 'workspaceId', 'updatedAt', 'deletedAt'];
const TYPED: ReadonlySet<string> = new Set(STUDY_COLLECTIONS);

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isTime = (v: unknown): v is string => typeof v === 'string' && TIME.test(v);
const sameKeys = (o: Record<string, unknown>, keys: readonly string[]) => {
	const have = Object.keys(o);
	return have.length === keys.length && keys.every((k) => k in o);
};

/** readableRow: whether one row of a pull collection decodes as the contract says. */
export function readableRow(collection: string, raw: unknown): boolean {
	if (TYPED.has(collection)) return parseRow(collection as StudyCollection, raw) !== null;
	const shape = SHAPES[collection];
	if (shape === undefined || !isRecord(raw)) return false;
	if (LIBRARY.has(collection) && sameKeys(raw, LIBRARY_TOMBSTONE)) return isTime(raw.updatedAt) && isTime(raw.deletedAt);
	if (!sameKeys(raw, shape)) return false;
	if ('updatedAt' in raw && !isTime(raw.updatedAt)) return false;
	if ('deletedAt' in raw && raw.deletedAt !== null && !isTime(raw.deletedAt)) return false;
	if (LIBRARY.has(collection) && raw.deletedAt !== null) return false; // a deleted library row is a tombstone
	switch (collection) {
		case 'pluginData':
			return typeof raw.pluginId === 'string' && typeof raw.key === 'string' && Number.isInteger(raw.version);
		case 'events':
			return raw.type !== 'lookup' && typeof raw.id === 'string';
		case 'sentences':
			return raw.sourcePack === '' && Number.isInteger(raw.userId);
		default:
			return true;
	}
}
