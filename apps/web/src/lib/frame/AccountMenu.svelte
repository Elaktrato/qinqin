<script lang="ts">
	// The account menu of the frame (design §9, §10): the avatar opens it.
	// First level: the user's name (the label of the item group, not an
	// item), Settings, Theme · <current> (a drill-in level inside the same
	// popup, plan Ruling), Admin settings for admins, Sources, Sign out. The
	// theme level: Back, the painted slot's themes, Appearance settings…;
	// ArrowLeft or Back returns to the first level with focus on Theme,
	// Escape closes the whole menu. A restricted session (forced password
	// change, MFA enrolment) gets Sources (an open page) and Sign out only.
	import { tick } from 'svelte';
	import { t } from '$lib/i18n';
	import { requestSignOut } from '$lib/account/signOut';
	import { canChangeServer, changeServer } from '$lib/native';
	import { type ThemeStore } from '$lib/theme/store.svelte';
	import Icon from '$lib/ui/Icon.svelte';
	import Menu from '$lib/ui/Menu.svelte';
	import MenuItem from '$lib/ui/MenuItem.svelte';
	import Avatar from './Avatar.svelte';
	import ThemeMenuItems from './ThemeMenuItems.svelte';
	import { useApp } from '$lib/context/context';
	const app = useApp();

	let {
		store = app.theme,
		restricted = false,
		align = 'end',
		direction = 'down'
	}: {
		store?: ThemeStore;
		restricted?: boolean;
		align?: 'start' | 'end';
		direction?: 'down' | 'up';
	} = $props();

	const uid = $props.id();
	let open = $state(false);
	let level = $state<'top' | 'theme'>('top');
	let error = $state('');
	let wrapper = $state<HTMLElement>();

	const name = $derived(app.auth.user?.username ?? '');
	// A restricted session may not fetch pictures (the route refuses it): the letter.
	const picture = $derived(restricted ? null : (app.auth.user?.avatarUrl ?? null));
	const themeName = $derived(store.themeOf(store.current.theme)?.name ?? store.current.theme);

	// A closed menu opens at the first level again; opening it clears an
	// old theme error (the person is trying again).
	$effect(() => {
		if (!open) level = 'top';
		else error = '';
	});

	// The theme error is announced at once (role="alert") and then goes
	// away on its own, so it never sits over the page.
	const ERROR_MS = 8000;
	$effect(() => {
		if (!error) return;
		const timer = setTimeout(() => (error = ''), ERROR_MS);
		return () => clearTimeout(timer);
	});

	function back(): void {
		level = 'top';
	}

	function themeKeys(e: KeyboardEvent): void {
		if (e.key !== 'ArrowLeft') return;
		e.preventDefault();
		e.stopPropagation();
		back();
		// The same settling as Back (a keepOpen pick): focus goes to Theme.
		void tick().then(() => wrapper?.querySelector<HTMLElement>('[data-menu-focus]')?.focus());
	}
</script>

<div class="account-menu" bind:this={wrapper}>
	<Menu label={t('nav.account.menu')} bind:open {align} {direction} tooltipPlacement={direction === 'up' ? 'above' : align === 'end' ? 'below-end' : 'below'} triggerClass="avatar-trigger">
		{#snippet trigger()}<Avatar {name} src={picture} />{/snippet}
		{#if level === 'top'}
			<div class="group" role="group" aria-labelledby="{uid}-who">
				<div class="who"><Avatar {name} size="l" src={picture} /><b id="{uid}-who">{name}</b></div>
				<MenuItem separator />
				{#if !restricted}
					<MenuItem href="/settings" icon="settings">{t('nav.settings')}</MenuItem>
					<MenuItem
						keepOpen
						focus
						icon="palette"
						label={t('account.menu.theme', { name: themeName })}
						onselect={() => (level = 'theme')}
						><span class="row"
							><span>{t('nav.account.theme')}</span> <span class="value">{themeName}<Icon name="forward" size="s" /></span></span
						></MenuItem
					>
					{#if app.auth.user?.admin}
						<MenuItem href="/settings?tab=admin" icon="admin">{t('nav.account.adminSettings')}</MenuItem>
					{/if}
				{/if}
				<!-- The open Sources page, for a restricted session too. -->
				<MenuItem href="/sources" icon="library">{t('nav.sources')}</MenuItem>
				<!-- Only the Android app has a server address to change (lib/native); it returns to the app's first-run screen. -->
				{#if canChangeServer()}
					<MenuItem icon="repeat" onselect={() => void changeServer()}>{t('nav.account.changeServer')}</MenuItem>
				{/if}
				<MenuItem separator />
				<MenuItem icon="sign-out" tone="bad" onselect={() => void requestSignOut(app)}>{t('nav.signOut')}</MenuItem>
			</div>
		{:else}
			<!-- The group only listens for ArrowLeft bubbling from its items (back one level). -->
			<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
			<div class="group" role="group" aria-label={t('account.menu.themes')} onkeydown={themeKeys}>
				<ThemeMenuItems {store} onback={back} onerror={(m) => (error = m)} />
			</div>
		{/if}
	</Menu>
	{#if error}<p class="error" role="alert">{error}</p>{/if}
</div>

<style>
	.account-menu {
		position: relative;
		display: inline-flex;
	}
	.group {
		display: contents;
	}
	.who {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-2) var(--space-3);
	}
	.who b {
		min-width: 0;
		overflow-wrap: anywhere;
		font-weight: var(--weight-strong);
	}
	.row {
		display: flex;
		align-items: center;
		gap: var(--space-4);
	}
	.value {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		margin-inline-start: auto;
		color: var(--readable-muted);
	}
	.error {
		position: absolute;
		top: calc(100% + var(--space-1));
		inset-inline-end: 0;
		z-index: var(--layer-float);
		margin: 0;
		padding: var(--space-1) var(--space-2);
		white-space: nowrap;
		background: var(--panel);
		border-inline-start: 3px solid var(--bad);
		color: var(--readable-bad);
		font-weight: var(--weight-strong);
		border-radius: var(--radius);
		box-shadow: var(--shadow-float);
	}
</style>
