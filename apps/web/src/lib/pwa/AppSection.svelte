<script lang="ts">
	import { onMount } from 'svelte';
	import { user } from '$lib/auth';
	import { workspaces } from '$lib/workspaces';
	import { appSectionView, clearOfflineData } from './appSectionView';
	import { currentIos, currentStandalone, installPrompt, promptInstall } from './install';
	import { offline, setPrepared } from './offlineState';
	import { readReceipt } from './prepareOffline';

	const uid = $props.id();
	const secure = typeof window !== 'undefined' && window.isSecureContext === true;
	let usage = $state<{ usage: number; quota: number } | null>(null);
	let cleared = $state(false);
	let busy = $state(false);

	// What was prepared: this session's result, else the receipt of the active workspace.
	const prepared = $derived.by(() => {
		if ($offline.prepared !== null) return $offline.prepared;
		const ws = $workspaces.current;
		if (!$user || !ws || cleared) return null;
		return readReceipt(typeof localStorage === 'undefined' ? null : localStorage, $user.id, ws.id);
	});

	const view = $derived(
		appSectionView({
			secure,
			standalone: currentStandalone(),
			ios: currentIos(),
			canPrompt: $installPrompt !== null,
			prepared,
			usage
		})
	);

	async function readUsage(): Promise<void> {
		try {
			const estimate = await navigator.storage?.estimate?.();
			usage =
				estimate && typeof estimate.usage === 'number' && typeof estimate.quota === 'number'
					? { usage: estimate.usage, quota: estimate.quota }
					: null;
		} catch {
			usage = null;
		}
	}

	async function clear(): Promise<void> {
		busy = true;
		await clearOfflineData(typeof caches === 'undefined' ? undefined : caches, typeof localStorage === 'undefined' ? null : localStorage);
		setPrepared(null);
		cleared = true;
		await readUsage();
		busy = false;
	}

	onMount(() => {
		if (secure) void readUsage();
	});
</script>

<section aria-labelledby="{uid}-heading" class="block">
	<h2 id="{uid}-heading">App</h2>
	{#if view.httpsNote}
		<p class="hint">{view.httpsNote}</p>
	{:else}
		{#if view.showInstall}
			<p><button type="button" onclick={() => void promptInstall()}>Install qinqin</button></p>
		{/if}
		{#if view.installedNote}
			<p class="hint">qinqin is installed on this device.</p>
		{/if}
		{#if view.iosHint}
			<p class="hint">To install on iPhone or iPad: tap Share, then Add to Home Screen.</p>
		{/if}
		{#if view.offlineLine}<p>{view.offlineLine}</p>{/if}
		{#if view.storageLine}<p class="hint">{view.storageLine}</p>{/if}
		{#if view.showClear}
			<p>
				<button type="button" onclick={() => void clear()} disabled={busy}>Clear offline data</button>
			</p>
			<p class="hint" role="status">
				{cleared ? 'Offline data cleared. Reviews that are still waiting to be sent were kept.' : ''}
			</p>
		{/if}
	{/if}
</section>

<style>
	.block {
		margin-bottom: 2rem;
	}
</style>
