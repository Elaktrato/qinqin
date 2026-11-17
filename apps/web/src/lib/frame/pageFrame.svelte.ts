// What a page may put into the frame's phone bar (#99): a title more
// specific than its section's label (an entry's word, a book's title) and
// page actions (the reader's rail button, an entry's "Add to deck").
//
// Both are tied to the calling component's lifetime: call them while the
// page component initialises (like $effect); they apply while it is mounted,
// follow reactive values (pass a function for the title), and go away when
// it is destroyed — so navigating to another page clears them, and
// navigating within the same page (new params) keeps them up to date.
//
//   <script>
//     import { setFrameTitle, setPageActions } from '$lib/frame/pageFrame.svelte';
//     setFrameTitle(() => entry.written);
//     setPageActions(actions);
//   </script>
//   {#snippet actions()}<IconButton label=… icon=… onclick=… />{/snippet}
//
// The actions render in the phone bar only (between the title and the
// flag), so a page keeps its own controls for the desktop frame and hides
// them below the breakpoint (lib/frame/breakpoint.ts). Use IconButtons:
// the bar is narrow, and an icon-only control is named and has a tooltip.
// One page owns the slot at a time (the last caller wins).

import type { Snippet } from 'svelte';
import { APP_NAME } from '$lib/app';
import { t } from '$lib/i18n';
import type { FrameSection } from './sections';
import { homeSection } from './sections';

const slots = $state<{ title: string | null; actions: Snippet | null }>({ title: null, actions: null });
// Which component's title is showing, so an old page's teardown never
// clears the title the next page has already set.
let titleOwner: object | null = null;

/** setFrameTitle sets the phone bar's title while the calling component is mounted. */
export function setFrameTitle(text: string | (() => string)): void {
	const read = typeof text === 'function' ? text : () => text;
	const owner = {};
	$effect(() => {
		titleOwner = owner;
		slots.title = read();
		return () => {
			if (titleOwner !== owner) return;
			titleOwner = null;
			slots.title = null;
		};
	});
}

/** setPageActions puts a snippet into the phone bar while the calling component is mounted. */
export function setPageActions(actions: Snippet): void {
	$effect(() => {
		slots.actions = actions;
		return () => {
			if (slots.actions === actions) slots.actions = null;
		};
	});
}

/** The frame reads the slots (lib/frame/PhoneBar.svelte). */
export const pageFrame = {
	get title(): string | null {
		return slots.title;
	},
	get actions(): Snippet | null {
		return slots.actions;
	}
};

// The pages of no section (the account menu's and the account flows'):
// the same catalogue text as their document titles. pageFrame.test.ts
// walks the route tree, so a new page of no section must be added here.
const ROUTE_TITLES: Record<string, () => string> = {
	'/settings': () => t('nav.settings'),
	'/sources': () => t('nav.sources'),
	'/account/password': () => t('auth.forced.passwordTitle'),
	'/account/two-factor-setup': () => t('account.mfa.setUp'),
	'/reset': () => t('auth.reset.title'),
	'/login': () => t('auth.signIn.title'),
	'/register': () => t('auth.register.title')
};

/**
 * phoneTitle: a page's own title, else its section's label, Home on Home,
 * else the route's own title (Settings, Sources, the account pages), else
 * the app's name (an unknown path).
 */
export function phoneTitle(
	override: string | null,
	current: string | null,
	sections: readonly FrameSection[],
	path: string
): string {
	if (override) return override;
	if (current === 'home') return homeSection().label;
	const section = sections.find((s) => s.id === current);
	if (section) return section.label;
	const trimmed = path.length > 1 ? path.replace(/\/+$/, '') : path;
	return ROUTE_TITLES[trimmed]?.() ?? APP_NAME;
}
