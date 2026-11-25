// Grading haptics: a short buzz when a card is graded. In the shell through the vibrator, in a phone browser
// through navigator.vibrate; nowhere else. A workspace setting switches it off.
import { shellPlugin } from './shell';

/** The workspace-settings key (docs/contracts/settings/workspace-settings.json). On unless stored as false. */
export const GRADE_HAPTICS_KEY = 'gradeHaptics';

export function readGradeHaptics(settings: Record<string, unknown> | null | undefined): boolean {
	const v = settings?.[GRADE_HAPTICS_KEY];
	return typeof v === 'boolean' ? v : true;
}

function browserCanVibrate(): boolean {
	if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return false;
	// Desktop Chrome has the function but no motor: only a touch device counts.
	return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
}

/** hapticsAvailable: whether the buzz can happen here (so the setting is worth showing). */
export function hapticsAvailable(): boolean {
	return shellPlugin() !== null || browserCanVibrate();
}

function buzz(ms: number): void {
	const shell = shellPlugin();
	if (shell !== null) {
		void Promise.resolve(shell.vibrate({ ms })).catch(() => undefined);
		return;
	}
	if (browserCanVibrate()) navigator.vibrate(ms);
}

/** buzzOnGrade: a short buzz for a pass, a longer one for "again" (grade 1); nothing when the switch is off. */
export function buzzOnGrade(settings: Record<string, unknown> | null | undefined, grade: number): void {
	if (!readGradeHaptics(settings)) return;
	buzz(grade === 1 ? 45 : 20);
}
