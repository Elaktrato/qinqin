<script lang="ts">
	// The phone drawer's content (design §9): the workspaces as a row of
	// flags (tap to switch, + to add) with the current one named under it,
	// the sections with icon and label (Home first: there is no logo to
	// tap), and the account at the bottom (the avatar opens the same account
	// menu as on desktop). Following a link or switching closes the drawer
	// (onnavigate).
	import { t } from '$lib/i18n';
	import { user } from '$lib/auth';
	import Flag from '$lib/components/Flag.svelte';
	import { workspaceDisplay } from '$lib/languages';
	import { select, workspaces } from '$lib/workspaces';
	import Icon from '$lib/ui/Icon.svelte';
	import IconButton from '$lib/ui/IconButton.svelte';
	import Tooltip from '$lib/ui/Tooltip.svelte';
	import AccountMenu from './AccountMenu.svelte';
	import { homeSection, type FrameSection } from './sections';

	let {
		sections,
		current,
		onnavigate
	}: { sections: readonly FrameSection[]; current: string | null; onnavigate: () => void } = $props();

	const list = $derived($workspaces.list);
	const active = $derived($workspaces.current);
	const activeDisplay = $derived(active ? workspaceDisplay(list, active) : null);
	const rows = $derived([homeSection(), ...sections]);

	function flagName(workspace: (typeof list)[number]): string {
		const d = workspaceDisplay(list, workspace);
		return d.showName && d.name !== d.label
			? t('app.workspaces.picker.currentNamed', { label: d.label, name: d.name })
			: t('app.workspaces.picker.current', { label: d.label });
	}

	function choose(id: number): void {
		select(id);
		onnavigate();
	}
</script>

<div class="workspaces">
	<div class="ws-row" role="group" aria-label={t('app.workspaces.picker.list')}>
		{#each list as workspace (workspace.id)}
			{@const name = flagName(workspace)}
			<Tooltip text={name}>
				{#snippet children()}
					<button
						type="button"
						class="ws"
						aria-label={name}
						aria-current={workspace.id === active?.id ? 'true' : undefined}
						data-current-workspace={workspace.id === active?.id || undefined}
						onclick={() => choose(workspace.id)}><Flag code={workspace.language} size={24} decorative /></button
					>
				{/snippet}
			</Tooltip>
		{/each}
		<IconButton
			href="/settings?tab=workspaces#new-workspace"
			label={t('nav.workspaces.add')}
			icon="add"
			class="ws add"
			onclick={onnavigate}
		/>
	</div>
	{#if active && activeDisplay}
		<p class="ws-name">
			<b>{activeDisplay.showName ? activeDisplay.name : activeDisplay.label}</b>
			{#if activeDisplay.showName && activeDisplay.name !== activeDisplay.label}<span>{activeDisplay.label}</span>{/if}
		</p>
	{/if}
</div>

<nav class="sections" aria-label={t('nav.main')}>
	{#each rows as row (row.id)}
		<a href={row.href} aria-current={current === row.id ? 'page' : undefined} onclick={onnavigate}
			><Icon name={row.icon} /><span>{row.label}</span></a
		>
	{/each}
</nav>

{#if $user}
	<div class="account">
		<AccountMenu direction="up" align="start" />
		<span class="who">{$user.username}</span>
		<IconButton href="/settings" label={t('nav.settings')} icon="settings" placement="above" onclick={onnavigate} />
	</div>
{/if}

<style>
	.workspaces {
		padding: var(--space-4) var(--space-3) var(--space-2);
	}
	.ws-row {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
	.ws,
	.ws-row :global(.add) {
		display: inline-grid;
		place-items: center;
		box-sizing: border-box;
		width: var(--hit);
		height: var(--hit);
		padding: 0;
		border: 1px solid var(--hair);
		border-radius: var(--radius);
		background: transparent;
		color: inherit;
		cursor: pointer;
	}
	.ws:hover {
		background: var(--raised);
	}
	/* The current workspace: an accent outline (a shape cue as well). */
	.ws[aria-current='true'] {
		border: 2px solid var(--accent);
	}
	.ws:focus-visible {
		outline: var(--focus-ring);
		outline-offset: var(--focus-ring-offset);
	}
	.ws-name {
		display: grid;
		margin: var(--space-2) 0 0;
		line-height: var(--line-tight);
	}
	.ws-name b {
		font-weight: var(--weight-strong);
	}
	.ws-name span {
		margin-top: var(--space-1);
		color: var(--readable-muted);
		font-size: var(--font-size-label);
	}
	.sections {
		display: grid;
		align-content: start;
		flex: 1;
		padding: var(--space-2) 0;
	}
	.sections a {
		position: relative;
		display: flex;
		align-items: center;
		gap: var(--space-3);
		min-height: var(--hit);
		padding: 0 var(--space-4);
		color: var(--text);
		text-decoration: none;
	}
	.sections a :global(svg) {
		color: var(--readable-muted);
	}
	.sections a:hover {
		background: var(--raised);
	}
	.sections a:focus-visible {
		outline: var(--focus-ring);
		outline-offset: calc(-1 * var(--focus-ring-offset));
	}
	/* The current place: accent icon and a short accent bar at the start. */
	.sections a[aria-current='page'],
	.sections a[aria-current='page'] :global(svg) {
		color: var(--accent);
	}
	.sections a[aria-current='page']::before {
		content: '';
		position: absolute;
		inset-inline-start: 0;
		top: 25%;
		bottom: 25%;
		width: 2px;
		border-radius: 1px;
		background: var(--accent);
	}
	.account {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		border-top: 1px solid var(--hair);
	}
	.who {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-weight: var(--weight-strong);
	}
	@media (forced-colors: active) {
		.ws[aria-current='true'] {
			border-color: Highlight;
		}
		.sections a[aria-current='page'],
		.sections a[aria-current='page'] :global(svg) {
			color: Highlight;
		}
		.sections a[aria-current='page']::before {
			background: Highlight;
			forced-color-adjust: none;
		}
	}
</style>
