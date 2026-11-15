// The `study-event` behaviour hook. Plugins subscribe through
// sdk.onStudyEvent; the host (postEvents) emits after a successful POST.
// A handler runs only while its plugin is enabled, and a throwing handler
// is logged and skipped so one plugin can never break event recording.

import type { PluginInfo, StudyEventBody } from '../api/types';

export type StudyEventHandler = (events: StudyEventBody[]) => void;

interface Registration {
	pluginId: string;
	handler: StudyEventHandler;
}

const handlers = new Set<Registration>();
let states: PluginInfo[] = [];

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
 * setHookStates tells the dispatcher which plugins the user enabled.
 * Before the first call every plugin counts as enabled, the server's own
 * default for a plugin without a state row.
 */
export function setHookStates(next: PluginInfo[]): void {
	states = next;
}

function enabled(pluginId: string): boolean {
	const state = states.find((s) => s.id === pluginId);
	return state ? state.enabled : true;
}

/** emitStudyEvents delivers a posted batch to every enabled plugin's handlers. */
export function emitStudyEvents(events: StudyEventBody[]): void {
	for (const { pluginId, handler } of [...handlers]) {
		if (!enabled(pluginId)) continue;
		try {
			handler(events);
		} catch (err) {
			console.error(`plugin ${pluginId}: study-event handler failed`, err);
		}
	}
}
