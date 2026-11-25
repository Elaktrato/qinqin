// The `script` study event: one answer in the writing-system trainer (docs/contracts/events/payloads.json).
// The server counts every one as activity of the feature `scripts` (heatmap, goals, weekly summary).

import { MODES, SYSTEM_IDS, type Mode, type SystemId } from './types';

export interface ScriptPayload {
	system: SystemId;
	/** The item (`hiragana:あ`) or word (`hiragana:word:ねこ`) answered. */
	item: string;
	mode: Mode;
	ok: boolean;
}

/** scriptPayload builds the payload; the member order is part of the contract. */
export function scriptPayload(system: SystemId, item: string, mode: Mode, ok: boolean): ScriptPayload {
	return { system, item, mode, ok };
}

export interface ScriptAnswer extends ScriptPayload {
	/** The event's time, epoch milliseconds. */
	at: number;
}

/** parseScriptEvent reads a stored event; null when it is not a readable `script` event. */
export function parseScriptEvent(event: { type: string; ts: string; payload: unknown }): ScriptAnswer | null {
	if (event.type !== 'script') return null;
	const p = event.payload;
	if (typeof p !== 'object' || p === null) return null;
	const { system, item, mode, ok } = p as Record<string, unknown>;
	if (typeof system !== 'string' || !(SYSTEM_IDS as readonly string[]).includes(system)) return null;
	if (typeof mode !== 'string' || !(MODES as readonly string[]).includes(mode)) return null;
	if (typeof item !== 'string' || item === '' || typeof ok !== 'boolean') return null;
	const at = Date.parse(event.ts);
	if (!Number.isFinite(at)) return null;
	return { system: system as SystemId, item, mode: mode as Mode, ok, at };
}
