<script lang="ts">
	import type { Workspace } from '$lib/api/types';
	import { workspaceDisplay } from '$lib/languages';
	import Flag from '$lib/components/Flag.svelte';

	// A workspace as flag + optional name. The flag carries the language
	// name for assistive tech; the visible name appears only when the
	// workspace has one or shares its language with another workspace.
	// `withLanguage` also prints the language label (settings list).
	let {
		workspace,
		list,
		size = 16,
		withLanguage = false
	}: { workspace: Workspace; list: readonly Workspace[]; size?: number; withLanguage?: boolean } =
		$props();

	const display = $derived(workspaceDisplay(list, workspace));
</script>

<span class="workspace-label">
	<Flag code={workspace.language} {size} decorative={withLanguage} />
	{#if withLanguage}
		<span class="language">{display.label}</span>
	{/if}
	{#if display.showName && !(withLanguage && display.name === display.label)}
		<span class="name">{display.name}</span>
	{/if}
</span>

<style>
	.workspace-label {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		min-width: 0;
	}

	.name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.language {
		font-weight: var(--weight-strong);
	}
</style>
