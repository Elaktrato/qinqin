// The plugin SDK: plugin data and study events behind the permissions a
// plugin's manifest declares. The permissions are a contract that catches
// mistakes and tells the user what a plugin does; all plugin code runs in
// one trusted bundle, so this is not a security boundary.

import { ApiError, api } from '../api/client';
import type { StudyEventBody } from '../api/types';
import { postEvents, type StudyEvent } from '../events';
import { newUlid } from '../ulid';
import type { ContractManifest, Permission } from './contract';
import { registerStudyEventHandler } from './hooks';

/** PermissionError names the plugin and the permission or declaration it lacks. */
export class PermissionError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'PermissionError';
	}
}

export interface DataRow<T = unknown> {
	key: string;
	data: T;
	version: number;
	updatedAt: string;
}

export interface DataScope {
	/** 404 or a deleted row is null; a string value is JSON-decoded. */
	get<T = unknown>(key: string): Promise<T | null>;
	put(key: string, value: unknown, opts?: { keepalive?: boolean }): Promise<void>;
	/** The prefix route, ordered by key. */
	list<T = unknown>(prefix?: string): Promise<DataRow<T>[]>;
	/** A missing row counts as deleted. */
	delete(key: string): Promise<void>;
}

export interface PluginSdk {
	readonly id: string;
	data: { user(): DataScope; workspace(id: number): DataScope };
	events: {
		list(opts: { workspace?: number; since?: string; types?: string[] }): Promise<StudyEvent[]>;
		record(type: string, workspace: number, payload?: unknown, at?: Date): Promise<void>;
	};
	onStudyEvent(handler: (events: StudyEventBody[]) => void): () => void;
}

const DEVICE = 'web';
const EPOCH = '1970-01-01T00:00:00Z';

// The API serves data as JSON, but a row may carry JSON text as a string (an
// older writer): JSON text is decoded, any other string is returned as it is,
// so put('k', 'hello') reads back as 'hello'. A string that is itself valid
// JSON text ('123', '{"a":1}') still reads back decoded, a quirk to avoid by
// storing objects instead of such strings.
function decodeData(data: unknown): unknown {
	if (typeof data !== 'string') return data;
	try {
		return JSON.parse(data) as unknown;
	} catch {
		return data;
	}
}

function scope(pluginId: string, workspace: number | null): DataScope {
	const base = `/api/plugins/${encodeURIComponent(pluginId)}/data`;
	const suffix = workspace === null ? '' : `?workspace=${workspace}`;
	// ':' is legal in a path segment, so keys like `entry:<id>` keep their readable form.
	const keyPath = (key: string) => {
		// '.' and '..' would be resolved away as path segments, and an empty key is no route.
		if (key === '' || key === '.' || key === '..') {
			throw new Error(`plugin ${pluginId}: invalid data key "${key}"`);
		}
		return `${base}/${encodeURIComponent(key).replaceAll('%3A', ':')}${suffix}`;
	};
	return {
		async get<T>(key: string): Promise<T | null> {
			try {
				const row = await api<{ data?: unknown } | undefined>(keyPath(key), { method: 'GET' });
				return row === undefined || row === null ? null : ((decodeData(row.data) ?? null) as T | null);
			} catch (err) {
				if (err instanceof ApiError && err.status === 404) return null;
				throw err;
			}
		},
		async put(key, value, opts) {
			await api<unknown>(keyPath(key), {
				method: 'PUT',
				body: value,
				...(opts?.keepalive ? { keepalive: true } : {})
			});
		},
		async list<T>(prefix?: string): Promise<DataRow<T>[]> {
			const query: string[] = [];
			if (workspace !== null) query.push(`workspace=${workspace}`);
			if (prefix !== undefined) query.push(`prefix=${encodeURIComponent(prefix)}`);
			const rows = await api<unknown[] | undefined>(
				`${base}${query.length ? `?${query.join('&')}` : ''}`
			);
			const out: DataRow<T>[] = [];
			for (const raw of Array.isArray(rows) ? rows : []) {
				const row = raw as Partial<Record<keyof DataRow, unknown>> | null;
				if (!row || typeof row.key !== 'string') continue;
				out.push({
					key: row.key,
					data: decodeData(row.data) as T,
					version: typeof row.version === 'number' ? row.version : 0,
					updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : ''
				});
			}
			return out;
		},
		async delete(key) {
			try {
				await api(keyPath(key), { method: 'DELETE' });
			} catch (err) {
				if (err instanceof ApiError && err.status === 404) return;
				throw err;
			}
		}
	};
}

/** createPluginSdk binds the SDK to one manifest; every call checks it. */
export function createPluginSdk(manifest: ContractManifest): PluginSdk {
	const id = manifest.id;
	function need(permission: Permission): void {
		if (!manifest.permissions.includes(permission)) {
			throw new PermissionError(`plugin ${id} needs the "${permission}" permission`);
		}
	}
	return {
		id,
		data: {
			user() {
				need('owns-data');
				return scope(id, null);
			},
			workspace(workspaceId: number) {
				need('owns-data');
				return scope(id, workspaceId);
			}
		},
		events: {
			list(opts) {
				need('read:study-events');
				const query = [`since=${encodeURIComponent(opts.since ?? EPOCH)}`];
				if (opts.workspace !== undefined) query.push(`workspace=${opts.workspace}`);
				const types = opts.types;
				return api<StudyEvent[] | undefined>(`/api/events?${query.join('&')}`).then((events) => {
					const list = Array.isArray(events) ? events : [];
					return types ? list.filter((e) => types.includes(e.type)) : list;
				});
			},
			record(type, workspace, payload = null, at = new Date()) {
				need('write:study-events');
				if (!manifest.events.some((e) => e.type === type)) {
					throw new PermissionError(`plugin ${id} does not declare the event type "${type}"`);
				}
				return postEvents([
					{
						id: newUlid(at.getTime()),
						workspaceId: workspace,
						device: DEVICE,
						ts: at.toISOString(),
						type,
						payload
					}
				]);
			}
		},
		onStudyEvent(handler) {
			if (!manifest.hooks.includes('study-event')) {
				throw new PermissionError(`plugin ${id} does not declare the "study-event" hook`);
			}
			return registerStudyEventHandler(id, handler);
		}
	};
}
