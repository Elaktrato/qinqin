// The `study-event` behaviour hook. Plugins subscribe through
// sdk.onStudyEvent; the host (postEvents) emits after a successful POST.
// A handler runs only while its plugin is enabled, and a throwing handler
// is logged and skipped so one plugin can never break event recording.

import type { PluginInfo, StudyEventBody } from '../api/types';

export type StudyEventHandler = (events: StudyEventBody[]) => void | Promise<void>;

interface Registration {
	pluginId: string;
	handler: StudyEventHandler;
}

const handlers = new Set<Registration>();
let states: PluginInfo[] | null = null;

/**
 * registerStudyEventHandler subscribes a handler for one plugin and
 * returns the unsubscribe.
 */
export function registerStudyEventHandler(
	pluginId: string,
	handler: StudyEventHandler
): () => void {
	const registration: Registration = { pluginId, handler };
	handlers.add(registration);
	return () => {
		handlers.delete(registration);
	};
}

/**
 * setHookStates tells the dispatcher which plugins the user enabled. An
 * empty list means the states are not known yet (loading, failed, signed
 * out): no handler runs. `null` (also the state before the first call)
 * counts every plugin as enabled, the server's default for a plugin
 * without a state row.
 */
export function setHookStates(next: PluginInfo[] | null): void {
	states = next;
}

function enabled(pluginId: string): boolean {
	if (states === null) return true;
	if (states.length === 0) return false;
	const state = states.find((s) => s.id === pluginId);
	return state ? state.enabled : true;
}

/** emitStudyEvents delivers a posted batch to every enabled plugin's handlers. */
export function emitStudyEvents(events: StudyEventBody[]): void {
	for (const { pluginId, handler } of [...handlers]) {
		if (!enabled(pluginId)) continue;
		const failed = (err: unknown) =>
			console.error(`plugin ${pluginId}: study-event handler failed`, err);
		try {
			// An async handler's rejection must not become an unhandled one.
			void Promise.resolve(handler(events)).catch(failed);
		} catch (err) {
			failed(err);
		}
	}
}
