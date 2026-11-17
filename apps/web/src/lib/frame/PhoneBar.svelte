<script lang="ts">
	// The phone bar (design §9, "Frame — phone"): the menu button, the page
	// title (plain text: pages keep their own h1), the page's actions
	// (pageFrame.svelte.ts) and the workspace flag. The menu button opens
	// the drawer (NavDrawer in lib/ui Drawer); the drawer closes itself when
	// the page changes.
	import { page } from '$app/state';
	import { t } from '$lib/i18n';
	import Drawer from '$lib/ui/Drawer.svelte';
	import IconButton from '$lib/ui/IconButton.svelte';
	import { onLeavePhoneFrame } from './breakpoint';
	import NavDrawer from './NavDrawer.svelte';
	import { pageFrame, phoneTitle } from './pageFrame.svelte';
	import type { FrameSection } from './sections';
	import WorkspaceMenu from './WorkspaceMenu.svelte';

	let { sections, current }: { sections: readonly FrameSection[]; current: string | null } = $props();

	const uid = $props.id();
	const drawerId = `${uid}-drawer`;
	let open = $state(false);

	const title = $derived(phoneTitle(pageFrame.title, current, sections));

	// A navigation (a link, Back, a redirect) closes the drawer.
	let lastPath: string | undefined;
	$effect(() => {
		const path = page.url?.pathname;
		if (lastPath !== undefined && path !== lastPath) open = false;
		lastPath = path;
	});

	// Leaving the phone frame with the drawer open closes it. The menu button
	// is hidden with the bar then, so focus goes to the page instead (after
	// the drawer's own focus return to the button).
	$effect(() => {
		if (!open) return;
		return onLeavePhoneFrame(() => {
			open = false;
			setTimeout(() => document.getElementById('main-content')?.focus());
		});
	});
</script>

<div class="phone-bar">
	<IconButton
		label={t('nav.drawer.open')}
		icon="menu"
		aria-expanded={open}
		aria-controls={open ? drawerId : undefined}
		placement="end"
		onclick={() => (open = true)}
	/>
	<span class="title">{title}</span>
	{#if pageFrame.actions}<span class="actions">{@render pageFrame.actions()}</span>{/if}
	<WorkspaceMenu />
</div>

<Drawer bind:open id={drawerId} label={t('nav.drawer')} initialFocus="[data-current-workspace]">
	<NavDrawer {sections} {current} onnavigate={() => (open = false)} />
</Drawer>

<style>
	.phone-bar {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		min-height: 3rem;
		padding: 0 var(--space-2);
	}
	.title {
		flex: 1;
		min-width: 0;
		padding-inline-start: var(--space-1);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: var(--font-size-m);
		font-weight: var(--weight-strong);
	}
	.actions {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
	}
</style>
