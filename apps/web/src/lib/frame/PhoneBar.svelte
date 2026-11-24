<script lang="ts">
	// The phone bar (design §9, "Frame — phone"): the menu button, the page
	// title (plain text: pages keep their own h1), the page's actions
	// (pageFrame.svelte.ts) and the workspace flag. The menu button opens
	// the drawer (NavDrawer in lib/ui Drawer); the drawer closes itself when
	// the page changes.
	//
	// Bottom-bar mode (#188, the person's `nav-layout`): the sections are in
	// the bottom bar (BottomBar.svelte), so there is no menu button and no
	// drawer; the avatar (the account menu) follows the flag instead.
	import { page } from '$app/state';
	import { t } from '$lib/i18n';
	import Drawer from '$lib/ui/Drawer.svelte';
	import IconButton from '$lib/ui/IconButton.svelte';
	import { onLeavePhoneFrame } from './breakpoint';
	import NavDrawer from './NavDrawer.svelte';
	import AccountMenu from './AccountMenu.svelte';
	import type { PhoneMode } from './navLayout';
	import { phoneTitle } from './pageFrame.svelte';
	import type { FrameSection } from './sections';
	import WorkspaceMenu from './WorkspaceMenu.svelte';
	import { useApp } from '$lib/context/context';
	const app = useApp();

	let {
		sections,
		current,
		mode = 'drawer'
	}: { sections: readonly FrameSection[]; current: string | null; mode?: PhoneMode } = $props();

	const uid = $props.id();
	const drawerId = `${uid}-drawer`;
	let open = $state(false);

	const title = $derived(phoneTitle(app.frame.title, current, sections, page.url?.pathname ?? '/'));

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
	// Switching to the bottom bar (Settings, another device) closes the drawer.
	// The menu button goes with the drawer, so focus goes to the page.
	$effect(() => {
		if (mode === 'bar' && open) {
			open = false;
			setTimeout(() => document.getElementById('main-content')?.focus());
		}
	});

	$effect(() => {
		if (!open) return;
		return onLeavePhoneFrame(() => {
			open = false;
			setTimeout(() => document.getElementById('main-content')?.focus());
		});
	});
</script>

<div class="phone-bar" class:bar-mode={mode === 'bar'}>
	{#if mode === 'drawer'}
		<IconButton
			label={t('nav.drawer.open')}
			icon="menu"
			aria-expanded={open}
			aria-controls={open ? drawerId : undefined}
			placement="end"
			onclick={() => (open = true)}
		/>
	{/if}
	<span class="title">{title}</span>
	{#if app.frame.actions}<span class="actions">{@render app.frame.actions()}</span>{/if}
	<WorkspaceMenu />
	{#if mode === 'bar'}<AccountMenu />{/if}
</div>

{#if mode === 'drawer'}
	<Drawer bind:open id={drawerId} label={t('nav.drawer')} initialFocus="[data-current-workspace]">
		<NavDrawer {sections} {current} onnavigate={() => (open = false)} />
	</Drawer>
{/if}

<style>
	.phone-bar {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		min-height: 3rem;
		padding: 0 var(--space-2);
	}
	/* No menu button before the title: it starts at the bar's edge. */
	.bar-mode .title {
		padding-inline-start: var(--space-2);
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
