// The drills the Practice area offers (docs/contracts/drills/README.md, "Adding a drill"). DRILLS holds the
// registered drills, the same ids as the core's DRILL_IDS (a test checks it); a drill's builder adds its definition
// here. The sample drill is a test harness: it is offered only on a device whose developer flag names it (DOM tests
// and the e2e suite set it), its events count nowhere on the server (it is not registered), and it shows the whole
// path in a real browser before the first drill exists.

import type { DrillDef } from './types';
import { sampleDrill } from './sample/sampleDrill';

/** The registered drills, in the order the list shows them. */
export const DRILLS: readonly DrillDef[] = Object.freeze<DrillDef[]>([]);

/** The developer flag: `localStorage["qinqin.dev.drills"] = "sample"` offers the sample drill on this device. */
export const DEV_DRILLS_KEY = 'qinqin.dev.drills';

/** devDrills: the harness drills this device's developer flag names. */
export function devDrills(storage: Pick<Storage, 'getItem'> | null): DrillDef[] {
	try {
		return storage?.getItem(DEV_DRILLS_KEY) === sampleDrill.id ? [sampleDrill] : [];
	} catch {
		return [];
	}
}

/** availableDrills: the drills that apply to a language (the registered ones, then the flagged harness). */
export function availableDrills(language: string, storage: Pick<Storage, 'getItem'> | null): DrillDef[] {
	return [...DRILLS, ...devDrills(storage)].filter((d) => d.appliesTo(language));
}

/** deviceStorage: the device's local storage, or null where it cannot be read. */
export function deviceStorage(): Storage | null {
	try {
		return typeof localStorage === 'undefined' ? null : localStorage;
	} catch {
		return null;
	}
}
