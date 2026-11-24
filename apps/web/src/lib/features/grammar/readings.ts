// The "show readings" toggle, remembered per browser. Storage can be
// missing or throw (private windows), so every access is guarded.

const KEY = 'qinqin.grammar.readings';

export interface ReadingsStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

export function browserReadingsStorage(): ReadingsStorage | null {
	try {
		return typeof localStorage === 'undefined' ? null : localStorage;
	} catch {
		return null;
	}
}

/** loadReadings: readings are shown unless the learner hid them. */
export function loadReadings(storage: ReadingsStorage | null): boolean {
	try {
		return storage?.getItem(KEY) !== '0';
	} catch {
		return true;
	}
}

export function saveReadings(storage: ReadingsStorage | null, shown: boolean): void {
	try {
		storage?.setItem(KEY, shown ? '1' : '0');
	} catch {
		// Not remembered; the toggle still works for this visit.
	}
}
