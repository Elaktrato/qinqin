// The session's lookup history recorder (#72, record 0009): the buffer of
// lookups not yet written and the copies of the rows it read (memory only),
// flushed when the page is hidden; and the one repair check after a Clear per
// workspace. The end of the session drops the buffer, the copies and the
// pending checks.

import { CORE_NAMESPACE, keyedData } from '../sync/keyed';
import { LOOKUPS_KEY, LOOKUP_CFG_KEY } from './lookups';
import { LookupRecorder, type RecorderIO } from './recorder';

/** recorderIO: the recorder's reads and writes of the qinqin-core rows. */
export const recorderIO: RecorderIO = {
	readRow: (ws) => keyedData(CORE_NAMESPACE, ws).find(LOOKUPS_KEY),
	writeRow: async (ws, data) => void (await keyedData(CORE_NAMESPACE, ws).put(LOOKUPS_KEY, data)),
	readCfg: () => keyedData(CORE_NAMESPACE, null).find(LOOKUP_CFG_KEY)
};

export class LookupsState {
	readonly recorder: LookupRecorder;
	/** The repair check after a Clear, per workspace (store.ts clearHistory). */
	readonly repairs = new Map<number, ReturnType<typeof setTimeout>>();

	constructor(io: RecorderIO = recorderIO) {
		this.recorder = new LookupRecorder(io);
	}

	/** dispose: the buffer, the copies and the pending repair checks belong to the session that ended. */
	dispose(): void {
		for (const timer of this.repairs.values()) clearTimeout(timer);
		this.repairs.clear();
		this.recorder.reset();
	}
}
