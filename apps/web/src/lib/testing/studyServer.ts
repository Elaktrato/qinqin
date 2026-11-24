// TEST-ONLY: an in-memory stand-in for the study routes of the server, as a
// `fetch` replacement: the paged pull v2 (docs/contracts/sync/: rounds,
// `until` truncated to the second, cursors 30 s before it, tombstones with a
// `since`), the push with last-write-wins on the edit time (second
// precision, docs/contracts/study/lww.json) and the plugin-data key routes.
// It counts every request by kind, so tests can pin how many requests a read
// or a write costs. It is not the server: shapes are the contract's, the
// edge cases (limits, 413, foreign plugins) are not modelled.

import { STUDY_COLLECTIONS, identityOf, parseRow, type StudyCollection, type StudyRow } from '../study/rows';

type Obj = Record<string, unknown>;

export interface ServerDataRow {
	pluginId: string;
	key: string;
	userId: number;
	workspaceId: number | null;
	data: unknown;
	version: number;
	updatedAt: string;
	deletedAt: string | null;
	/** The edit time last-write-wins compares (modified_at), second precision. */
	editedAt: string;
}

export interface RequestCounts {
	pullPages: number;
	pushes: number;
	dataReads: number;
	dataWrites: number;
	events: number;
	other: number;
}

const ROUND_ORDER = ['pluginStates', 'pluginData', ...STUDY_COLLECTIONS];
const ULID = '01JABCDEFGHJKMNPQRSTVWXYZ0';

function sec(iso: string): number {
	return Math.floor(Date.parse(iso) / 1000) * 1000;
}

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function encode(o: Obj): string {
	return btoa(JSON.stringify(o)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function decode(token: string): Obj {
	return JSON.parse(atob(token.replaceAll('-', '+').replaceAll('_', '/'))) as Obj;
}

/**
 * StudyServer: one user's study data. `now` is the server clock (ms);
 * `pageSize` the rows per pull page (the server's default is 500).
 */
export class StudyServer {
	typed = new Map<string, StudyRow & { collection: StudyCollection }>();
	data = new Map<string, ServerDataRow>();
	counts: RequestCounts = { pullPages: 0, pushes: 0, dataReads: 0, dataWrites: 0, events: 0, other: 0 };
	/** Every request URL, in order. */
	log: string[] = [];
	pageSize: number;
	now: () => number;
	/** Called before each answer: a test can change data between pages. */
	beforeAnswer: ((url: string) => void) | null = null;

	constructor(opts: { now?: () => number; pageSize?: number } = {}) {
		this.now = opts.now ?? Date.now;
		this.pageSize = opts.pageSize ?? 500;
	}

	private stamp(): string {
		return new Date(this.now()).toISOString();
	}

	/** putTyped stores a typed row as given (meta included), e.g. a fixture. */
	putTyped(collection: StudyCollection, row: StudyRow): void {
		this.typed.set(`${collection}:${row.workspaceId}:${identityOf(collection, row)}`, { ...row, collection });
	}

	/** putData stores a plugin-data row; the edit time defaults to its updatedAt. */
	putData(row: Omit<ServerDataRow, 'editedAt' | 'userId' | 'version'> & Partial<ServerDataRow>): void {
		this.data.set(this.dataKey(row.pluginId, row.workspaceId, row.key), {
			userId: 1,
			version: 1,
			editedAt: row.updatedAt,
			...row
		});
	}

	private dataKey(pluginId: string, workspaceId: number | null, key: string): string {
		return `${pluginId}:${workspaceId ?? 'user'}:${key}`;
	}

	/** typedRows: the stored rows of one collection and workspace, tombstones included. */
	typedRows(collection: StudyCollection, workspaceId: number): StudyRow[] {
		return [...this.typed.values()].filter((r) => r.collection === collection && r.workspaceId === workspaceId);
	}

	resetCounts(): void {
		this.counts = { pullPages: 0, pushes: 0, dataReads: 0, dataWrites: 0, events: 0, other: 0 };
		this.log = [];
	}

	/** fetch is the replacement for globalThis.fetch. */
	fetch = async (input: unknown, init?: RequestInit): Promise<Response> => {
		const url = new URL(String(input), 'http://x.invalid');
		this.log.push(`${init?.method ?? 'GET'} ${url.pathname}${url.search}`);
		this.beforeAnswer?.(String(input));
		const method = init?.method ?? 'GET';
		if (url.pathname === '/api/sync/pull') {
			this.counts.pullPages++;
			return this.pull(url.searchParams);
		}
		if (url.pathname === '/api/sync/push' && method === 'POST') {
			this.counts.pushes++;
			return this.push(JSON.parse(String(init?.body)) as Obj);
		}
		if (url.pathname === '/api/events') {
			this.counts.events++;
			return json([]);
		}
		const m = /^\/api\/plugins\/([^/]+)\/data(?:\/(.+))?$/.exec(url.pathname);
		if (m !== null) {
			const ws = url.searchParams.get('workspace');
			const workspaceId = ws === null ? null : Number(ws);
			const pluginId = decodeURIComponent(m[1]);
			if (m[2] === undefined) {
				this.counts.dataReads++;
				const prefix = url.searchParams.get('prefix') ?? '';
				const rows = [...this.data.values()]
					.filter((r) => r.pluginId === pluginId && r.workspaceId === workspaceId && r.deletedAt === null && r.key.startsWith(prefix))
					.sort((a, b) => (a.key < b.key ? -1 : 1))
					.map((r) => this.wire(r));
				return json(rows);
			}
			return this.dataRoute(method, pluginId, workspaceId, decodeURIComponent(m[2]), init);
		}
		this.counts.other++;
		return json({ error: 'not_found', message: 'no such route' }, 404);
	};

	private wire(r: ServerDataRow): Obj {
		const { editedAt: _e, ...rest } = r;
		void _e;
		return rest;
	}

	private dataRoute(method: string, pluginId: string, workspaceId: number | null, key: string, init?: RequestInit): Response {
		const id = this.dataKey(pluginId, workspaceId, key);
		const stored = this.data.get(id);
		if (method === 'GET') {
			this.counts.dataReads++;
			if (stored === undefined || stored.deletedAt !== null) return json({ error: 'not_found', message: 'x' }, 404);
			return json(this.wire(stored));
		}
		this.counts.dataWrites++;
		const now = this.stamp();
		if (method === 'PUT') {
			const row: ServerDataRow = {
				pluginId,
				key,
				userId: 1,
				workspaceId,
				data: JSON.parse(String(init?.body)) as unknown,
				version: (stored?.version ?? 0) + 1,
				updatedAt: now,
				deletedAt: null,
				editedAt: now
			};
			this.data.set(id, row);
			return json(this.wire(row));
		}
		if (method === 'DELETE') {
			if (stored === undefined || stored.deletedAt !== null) return json({ error: 'not_found', message: 'x' }, 404);
			this.data.set(id, { ...stored, deletedAt: now, updatedAt: now, editedAt: now, version: stored.version + 1 });
			return new Response(null, { status: 204 });
		}
		return json({ error: 'bad_request', message: 'x' }, 400);
	}

	private roundRows(collections: string[], workspace: number, since: number | null, until: number, tombstones: boolean): { collection: string; row: Obj; at: number }[] {
		const out: { collection: string; row: Obj; at: number }[] = [];
		const inWindow = (stamp: string, deleted: boolean) => {
			const at = Date.parse(stamp);
			if (at >= until) return false;
			if (since !== null) return at >= since;
			return !deleted || tombstones;
		};
		for (const collection of ROUND_ORDER) {
			if (!collections.includes(collection)) continue;
			const rows: { row: Obj; at: number }[] = [];
			if (collection === 'pluginData') {
				for (const r of this.data.values()) {
					if (r.workspaceId !== null && r.workspaceId !== workspace) continue;
					if (!inWindow(r.updatedAt, r.deletedAt !== null)) continue;
					rows.push({ row: this.wire(r), at: Date.parse(r.updatedAt) });
				}
			} else if ((STUDY_COLLECTIONS as readonly string[]).includes(collection)) {
				for (const r of this.typed.values()) {
					if (r.collection !== collection || r.workspaceId !== workspace) continue;
					if (!inWindow(r.updatedAt, r.deletedAt !== null)) continue;
					const { collection: _c, ...row } = r;
					void _c;
					rows.push({ row: row as Obj, at: Date.parse(r.updatedAt) });
				}
			}
			rows.sort((a, b) => a.at - b.at);
			out.push(...rows.map((r) => ({ collection, ...r })));
		}
		return out;
	}

	private pull(params: URLSearchParams): Response {
		let state: Obj;
		const page = params.get('page');
		if (page !== null) {
			state = decode(page.slice(3));
		} else {
			const cursor = params.get('since');
			const collections = (params.get('collections') ?? ROUND_ORDER.join(',')).split(',');
			state = {
				collections,
				workspace: Number(params.get('workspace')),
				since: cursor === null ? null : (decode(cursor.slice(3)).time as number),
				until: sec(this.stamp()),
				tombstones: params.get('tombstones') === '1',
				offset: 0,
				first: true
			};
		}
		const collections = state.collections as string[];
		const all = this.roundRows(collections, state.workspace as number, state.since as number | null, state.until as number, state.tombstones as boolean);
		const offset = state.offset as number;
		const slice = all.slice(offset, offset + this.pageSize);
		const more = offset + this.pageSize < all.length;
		const body: Obj = {
			format: 2,
			instanceId: ULID,
			until: new Date(state.until as number).toISOString().replace('.000Z', 'Z'),
			scope: state.first === true ? { workspaces: [{ id: state.workspace, language: 'zh' }], languages: ['zh'], catalogue: '"k"' } : null,
			restarted: [],
			collections: Object.fromEntries(collections.map((c) => [c, slice.filter((r) => r.collection === c).map((r) => r.row)])),
			more,
			next: more ? `p2.${encode({ ...state, offset: offset + this.pageSize, first: false })}` : null,
			cursor: more
				? null
				: `c2.${encode({ time: (state.until as number) - 30_000 })}`
		};
		return json(body);
	}

	private push(body: Obj): Response {
		let accepted = 0;
		let skipped = 0;
		const nowMs = this.now();
		for (const collection of STUDY_COLLECTIONS) {
			for (const raw of (body[collection] as Obj[] | undefined) ?? []) {
				const row = parseRow(collection, { version: 1, deletedAt: null, ...raw });
				if (row === null) throw new Error(`studyServer: a ${collection} item does not decode`);
				const id = `${collection}:${row.workspaceId}:${identityOf(collection, row)}`;
				const stored = this.typed.get(id);
				const deleted = typeof raw.deletedAt === 'string';
				const edited = Math.min(nowMs, Date.parse(deleted ? (raw.deletedAt as string) : row.updatedAt));
				if (deleted && (stored === undefined || stored.deletedAt !== null)) {
					skipped++;
					continue;
				}
				const storedAt = stored === undefined ? null : Date.parse(stored.deletedAt ?? stored.updatedAt);
				if (storedAt !== null && sec(new Date(storedAt).toISOString()) > sec(new Date(edited).toISOString())) {
					skipped++;
					continue;
				}
				const stamp = new Date(edited).toISOString();
				this.typed.set(id, {
					...row,
					version: (stored?.version ?? 0) + 1,
					updatedAt: stamp,
					deletedAt: deleted ? stamp : null,
					collection
				});
				accepted++;
			}
		}
		for (const raw of (body.pluginData as Obj[] | undefined) ?? []) {
			const workspaceId = (raw.workspaceId as number | null | undefined) ?? null;
			const id = this.dataKey(raw.pluginId as string, workspaceId, raw.key as string);
			const stored = this.data.get(id);
			const deleted = typeof raw.deletedAt === 'string';
			const edited = Math.min(nowMs, Date.parse((deleted ? raw.deletedAt : raw.updatedAt) as string));
			if (deleted && (stored === undefined || stored.deletedAt !== null)) {
				skipped++;
				continue;
			}
			if (stored !== undefined && sec(stored.editedAt) > sec(new Date(edited).toISOString())) {
				skipped++;
				continue;
			}
			const now = this.stamp();
			this.data.set(id, {
				pluginId: raw.pluginId as string,
				key: raw.key as string,
				userId: 1,
				workspaceId,
				data: deleted ? (stored?.data ?? null) : raw.data,
				version: (stored?.version ?? 0) + 1,
				updatedAt: now,
				deletedAt: deleted ? now : null,
				editedAt: new Date(edited).toISOString()
			});
			accepted++;
		}
		return json({ eventsAccepted: 0, eventDuplicates: 0, dataAccepted: accepted, dataSkipped: skipped, dataRefused: 0 });
	}
}
