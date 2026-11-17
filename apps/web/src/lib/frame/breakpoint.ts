// The frame's one layout switch (#99): the phone frame (menu button, title,
// flag; the drawer) below 720px, the desktop frame (top bar, raised panel)
// at and above. Script that follows the switch imports it from here instead
// of repeating the number: PhoneBar closes its drawer through
// onLeavePhoneFrame. CSS cannot import: routes/+layout.svelte writes the
// same query, and pageFrame.test.ts holds the two together; a page that
// changes its own layout with the frame should do the same.

/** The first desktop width, in CSS px. */
export const FRAME_PHONE_BREAKPOINT = 720;
/** The widest phone width, in CSS px (a hair under the breakpoint, for fractional zoom widths). */
export const PHONE_MAX_WIDTH = 719.98;
/** For matchMedia and for documentation: true on the phone frame. */
export const PHONE_MEDIA_QUERY = `(max-width: ${PHONE_MAX_WIDTH}px)`;

/**
 * onLeavePhoneFrame calls `run` once the window leaves the phone frame
 * (grows to the breakpoint or wider: a rotation, a resize, a zoom change)
 * and returns the unsubscribe. A no-op where matchMedia is missing.
 */
export function onLeavePhoneFrame(run: () => void): () => void {
	if (typeof matchMedia !== 'function') return () => {};
	const query = matchMedia(PHONE_MEDIA_QUERY);
	const change = (e: { matches: boolean }): void => {
		if (!e.matches) run();
	};
	query.addEventListener('change', change);
	return () => query.removeEventListener('change', change);
}
