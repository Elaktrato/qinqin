// The frame's one layout switch (#99): the phone frame (menu button, title,
// flag; the drawer) below 720px, the desktop frame (top bar, raised panel)
// at and above. Pages that change their own layout with the frame import
// these instead of repeating the number (the reader's lookup sheet, search's
// list/entry switch). CSS cannot import: routes/+layout.svelte writes the
// same query, and pageFrame.test.ts holds the two together.

/** The first desktop width, in CSS px. */
export const FRAME_PHONE_BREAKPOINT = 720;
/** The widest phone width, in CSS px (a hair under the breakpoint, for fractional zoom widths). */
export const PHONE_MAX_WIDTH = 719.98;
/** For matchMedia and for documentation: true on the phone frame. */
export const PHONE_MEDIA_QUERY = `(max-width: ${PHONE_MAX_WIDTH}px)`;
