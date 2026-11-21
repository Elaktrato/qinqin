<script lang="ts">
	import { onMount } from 'svelte';
	import { getToken } from '$lib/api/client';
	import { user } from '$lib/auth';
	import { t } from '$lib/i18n';
	import { Button, Section } from '$lib/ui';
	import { workspaces } from '$lib/workspaces';
	import { appSectionView, clearOfflineData } from './appSectionView';
	import { ownPartition } from './partitions';
	import { currentIos, currentStandalone, installPrompt, promptInstall } from './install';
	import { offline, setPrepared } from './offlineState';
	import { readReceipt } from './prepareOffline';

	const secure = typeof window !== 'undefined' && window.isSecureContext === true;
	let usage = $state<{ usage: number; quota: number } | null>(null);
	let cleared = $state(false);
	let busy = $state(false);
	// The credential's cache partition, when the worker really holds it.
	let partition = $state<string | null>(null);

	async function refreshPartition(): Promise<void> {
		const token = getToken();
		try {
			const name = token === null ? null : await ownPartition(token);
			partition = name !== null && typeof caches !== 'undefined' && (await caches.has(name)) ? name : null;
		} catch {
			partition = null;
		}
	}

	// What was prepared: this session's result, else the receipt of the active workspace.
	const prepared = $derived.by(() => {
		if ($offline.prepared !== null && partition !== null) return $offline.prepared;
		const ws = $workspaces.current;
		if (!$user || !ws || cleared) return null;
		return readReceipt(typeof localStorage === 'undefined' ? null : localStorage, $user.id, ws.id, partition);
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
		await refreshPartition();
		await readUsage();
		busy = false;
	}

	onMount(() => {
		if (secure) {
			void readUsage();
			void refreshPartition();
		}
	});
</script>

<Section title={t('pwa.app.title')}>
	{#if view.httpsNote}
		<p class="hint">{view.httpsNote}</p>
	{:else}
		{#if view.showInstall}
			<p><Button onclick={() => void promptInstall()}>{t('pwa.app.install')}</Button></p>
		{/if}
		{#if view.installedNote}
			<p class="hint">{t('pwa.app.installed')}</p>
		{/if}
		{#if view.iosHint}
			<p class="hint">{t('pwa.app.iosHint')}</p>
		{/if}
		{#if view.offlineLine}<p>{view.offlineLine}</p>{/if}
		{#if view.storageLine}<p class="hint">{view.storageLine}</p>{/if}
		{#if view.showClear}
			<p>
				<Button tone="danger" onclick={() => void clear()} disabled={busy}>{t('pwa.app.clear')}</Button>
			</p>
			<p class="hint" role="status">
				{cleared ? t('pwa.app.cleared') : ''}
			</p>
		{/if}
	{/if}
</Section>

<style>
	/* Sections carry the spacing; the view brings no box (#106). */
</style>
