// The plugin SDK: plugin data (the keyed rows of lib/sync/keyed.ts, in the
// plugin's namespace) and recording study events behind the permissions a
// plugin's manifest declares. Only the journal and grammar use it (#199
// retires it). The permissions are a contract that catches mistakes and tells
// the user what a plugin does; all plugin code runs in one trusted bundle, so
// this is not a security boundary.

import { postEvents } from '../events';
import { keyedData, type KeyedScope } from '../sync/keyed';
import { newUlid } from '../ulid';
import type { ContractManifest, Permission } from './contract';

/** PermissionError names the plugin and the permission or declaration it lacks. */
export class PermissionError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'PermissionError';
	}
}

/** The data scope of a plugin: the keyed rows of its namespace (lib/sync/keyed.ts). */
export type DataScope = KeyedScope;

export interface PluginSdk {
	readonly id: string;
	data: { user(): DataScope; workspace(id: number): DataScope };
	events: {
		record(type: string, workspace: number, payload?: unknown, at?: Date): Promise<void>;
	};
}

const DEVICE = 'web';

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
				return keyedData(id, null);
			},
			workspace(workspaceId: number) {
				need('owns-data');
				return keyedData(id, workspaceId);
			}
		},
		events: {
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
		}
	};
}
