<script lang="ts">
	// The desktop top bar (design §9, frame A): the logo is the Home link
	// (tooltip "Home"; there is no Home icon), the sections centred as
	// icon-only links with tooltips (the current one: accent icon and a
	// small accent dot, aria-current="page"), and on the right the workspace
	// flag and the avatar. No pills, no borders (§5).
	import { APP_NAME } from '$lib/frame/app';
	import { t } from '$lib/i18n';
	import Logo from '$lib/components/Logo.svelte';
	import IconButton from '$lib/ui/IconButton.svelte';
	import Tooltip from '$lib/ui/Tooltip.svelte';
	import AccountMenu from './AccountMenu.svelte';
	import type { FrameSection } from './sections';
	import WorkspaceMenu from './WorkspaceMenu.svelte';

	let { sections, current }: { sections: readonly FrameSection[]; current: string | null } = $props();
</script>

<div class="top-bar">
	<Tooltip text={t('nav.home')}>
		{#snippet children()}
			<a
				class="brand"
				href="/"
				aria-label={t('nav.brand.home', { app: APP_NAME })}
				aria-current={current === 'home' ? 'page' : undefined}><Logo /></a
			>
		{/snippet}
	</Tooltip>

	<nav class="sections" aria-label={t('nav.main')}>
		{#each sections as section (section.id)}
			<span class="section" class:current={current === section.id}>
				<IconButton
					href={section.href}
					label={section.label}
					icon={section.icon}
					aria-current={current === section.id ? 'page' : undefined}
				/>
				{#if current === section.id}<span class="dot" aria-hidden="true"></span>{/if}
			</span>
		{/each}
	</nav>

	<div class="end">
		<WorkspaceMenu />
		<AccountMenu />
	</div>
</div>

<style>
	.top-bar {
		display: grid;
		grid-template-columns: 1fr auto 1fr;
		align-items: center;
		gap: var(--space-4);
		min-height: 3rem;
		padding: 0 var(--space-3);
	}
	.brand {
		display: inline-grid;
		place-items: center;
		width: 2.5rem;
		height: 2.5rem;
		border-radius: var(--radius);
		color: var(--accent);
		text-decoration: none;
	}
	.brand:hover {
		background: var(--raised);
	}
	.brand:focus-visible {
		outline: var(--focus-ring);
		outline-offset: var(--focus-ring-offset);
	}
	.sections {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}
	.section {
		position: relative;
		display: inline-flex;
		color: var(--readable-muted);
	}
	.section:hover {
		color: var(--text);
	}
	.section.current {
		color: var(--accent);
	}
	/* The current place: a small accent dot under the icon (a shape cue as
	   well as the colour). */
	.dot {
		position: absolute;
		bottom: -0.2rem;
		left: 50%;
		width: 4px;
		height: 4px;
		border-radius: 50%;
		background: var(--accent);
		translate: -50% 0;
		pointer-events: none;
	}
	.end {
		justify-self: end;
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}
	@media (forced-colors: active) {
		.brand,
		.section.current {
			color: Highlight;
		}
		.dot {
			background: Highlight;
			forced-color-adjust: none;
		}
	}
</style>
