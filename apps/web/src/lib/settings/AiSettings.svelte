<script lang="ts">
	import { onMount, tick } from 'svelte';
	import {
		deleteAiKey,
		getAiProviders,
		getAiStatus,
		saveAiKey,
		setActiveProvider,
		setAiModel,
		testAiKey,
		type AiStatus,
		type ProvidersResponse
	} from '$lib/api/ai';
	import { aiErrorView } from '$lib/plugins/journal/aiErrors';
	import { t } from '$lib/i18n';
	import AiCustomEndpoints from './AiCustomEndpoints.svelte';
	import AiProviderForm from './AiProviderForm.svelte';
	import { aiSettingsView, modelSuggestions } from './aiSettingsView';
	import { Button, Chip, Field, Section } from '$lib/ui';

	let status = $state<AiStatus | null>(null);
	let registry = $state<ProvidersResponse | null>(null);
	let loadError = $state('');
	let busy = $state(false);
	let message = $state('');
	let error = $state('');
	let confirmingRemove = $state<string | null>(null);
	let editingModel = $state<string | null>(null);
	let modelDraft = $state('');

	const view = $derived(status && registry ? aiSettingsView(status, registry) : null);

	async function load(): Promise<void> {
		loadError = '';
		try {
			[status, registry] = await Promise.all([getAiStatus(), getAiProviders()]);
		} catch {
			loadError = t('settings.ai.loadError');
		}
	}

	onMount(() => {
		void load();
	});

	/** Runs one action: a busy flag, the message on success and the error text on failure. */
	async function act(pending: string, done: string, run: () => Promise<AiStatus | void>): Promise<boolean> {
		busy = true;
		error = '';
		message = pending; // stays visible until the call ends
		try {
			const next = await run();
			if (next) status = next;
			message = done;
			return true;
		} catch (err) {
			error = aiErrorView(err, 'review').text;
			return false;
		} finally {
			busy = false;
		}
	}

	async function addKey(provider: string, key: string, model: string): Promise<void> {
		await act(key !== '' ? t('settings.ai.act.checkingKey') : t('common.state.saving'), t('settings.ai.act.saved'), () =>
			saveAiKey(provider, key, model)
		);
	}

	async function makeActive(id: string): Promise<void> {
		await act(t('settings.ai.act.changingActive'), t('settings.ai.act.activeChanged'), () => setActiveProvider(id));
	}

	async function testKey(id: string): Promise<void> {
		await act(t('settings.ai.act.testing'), t('settings.ai.act.keyWorks'), () => testAiKey(id));
	}

	async function remove(id: string): Promise<void> {
		const ok = await act(t('settings.ai.act.removing'), t('settings.ai.act.removed'), async () => {
			await deleteAiKey(id);
			return getAiStatus();
		});
		if (ok) confirmingRemove = null;
	}

	function removeButton(id: string): HTMLElement | null {
		return document.getElementById(`remove-${id}`);
	}

	async function cancelRemove(id: string): Promise<void> {
		confirmingRemove = null;
		await tick();
		removeButton(id)?.focus();
	}

	function startModel(id: string, model: string): void {
		editingModel = id;
		modelDraft = model;
	}

	async function saveModel(event: SubmitEvent, id: string): Promise<void> {
		event.preventDefault();
		const ok = await act(t('settings.ai.act.savingModel'), t('settings.ai.act.modelSaved'), () =>
			setAiModel(id, modelDraft.trim())
		);
		if (ok) editingModel = null;
	}

	/** Reloads after the endpoint list changed; the caller handles a failure. */
	async function reloadRegistry(): Promise<void> {
		[status, registry] = await Promise.all([getAiStatus(), getAiProviders()]);
	}

	const customEndpoints = $derived(registry ? registry.providers.filter((p) => p.custom) : []);
</script>

<Section title={t('settings.ai.title')}>

	{#if loadError}
		<p class="error" role="alert">{loadError}</p>
		<Button onclick={load}>{t('settings.ai.retry')}</Button>
	{:else if !status || !registry || !view}
		<p>{t('common.loading')}</p>
	{:else}
		{#if view.testProvider}
			<p><Chip>{t('settings.ai.testProvider')}</Chip></p>
		{/if}
		{#if view.banner}
			<p class="banner">{view.banner}</p>
		{/if}

		{#if view.rows.length > 0}
			<h3>{t('settings.ai.yourProviders')}</h3>
			<ul class="rows" aria-label={t('settings.ai.yourProviders')}>
				{#each view.rows as row (row.id)}
					<li class:active={row.active}>
						<div class="head">
							<strong>{row.name}</strong>
							{#if row.active}<Chip>{t('settings.ai.active')}</Chip>{/if}
							<span class="muted">{t('settings.ai.keyHint', { hint: row.hint })}</span>
						</div>
						{#if row.adminLine}<p class="muted">{row.adminLine}</p>{/if}
						{#if row.state === 'disabled'}
							<p class="warn">{row.stateText}</p>
						{:else}
							<p class="muted">
								<span>{row.modelLabel}</span>
								{#if row.vision}<Chip>{t('settings.ai.readsPhotos')}</Chip>{/if}
								{#if row.structuredLabel}<Chip>{row.structuredLabel}</Chip>{/if}
							</p>
							{#if row.stateText}<p class="warn">{row.stateText}</p>{/if}
						{/if}

						{#if editingModel === row.id}
							{@const prov = registry.providers.find((p) => p.id === row.id)}
							<form class="modelform" onsubmit={(e) => saveModel(e, row.id)}>
								<Field
									label={t('settings.ai.modelFor', { name: row.name })}
									list={`models-${row.id}`}
									bind:value={modelDraft}
									autocomplete="off"
									spellcheck="false"
								/>
								<datalist id={`models-${row.id}`}>
									{#each modelSuggestions(prov) as m (m.id)}<option value={m.id}>{m.label}</option>{/each}
								</datalist>
								<div class="actions">
									<Button type="submit" disabled={busy || modelDraft.trim() === ''}>{t('settings.ai.saveModel')}</Button>
									<Button onclick={() => (editingModel = null)}>{t('common.action.cancel')}</Button>
								</div>
							</form>
						{:else if confirmingRemove === row.id}
							<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
							<span
								class="confirm"
								role="group"
								aria-label={t('settings.ai.removeConfirm', { name: row.name })}
								tabindex="-1"
								onkeydown={(e) => e.key === 'Escape' && cancelRemove(row.id)}
							>
								{t('settings.ai.removeConfirm', { name: row.name })}
								<Button tone="danger" onclick={() => remove(row.id)} disabled={busy}>
									{t('settings.ai.removeYes')}
								</Button>
								<Button onclick={() => cancelRemove(row.id)}>{t('common.action.cancel')}</Button>
							</span>
						{:else}
							<div class="actions">
								{#if row.state !== 'disabled'}
									{#if !row.active && row.state === 'ok'}
										<Button aria-label={t('settings.ai.makeActiveNamed', { name: row.name })} disabled={busy} onclick={() => makeActive(row.id)}>
											{t('settings.ai.makeActive')}
										</Button>
									{/if}
									{#if row.state === 'ok'}
										<Button aria-label={t('settings.ai.testNamed', { name: row.name })} disabled={busy} onclick={() => testKey(row.id)}>
											{t('settings.ai.test')}
										</Button>
									{/if}
									<Button aria-label={t('settings.ai.changeModelNamed', { name: row.name })} disabled={busy} onclick={() => startModel(row.id, row.model)}>
										{t('settings.ai.changeModel')}
									</Button>
								{/if}
								<Button
									id={`remove-${row.id}`}
									tone="danger"
									aria-label={t('settings.ai.removeNamed', { name: row.name })}
									disabled={busy}
									onclick={() => (confirmingRemove = row.id)}
								>
									{t('common.action.remove')}
								</Button>
							</div>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}

		{#if view.canAddKey}
			<AiProviderForm
				builtin={view.addable.builtin}
				custom={view.addable.custom}
				{busy}
				onsave={addKey}
			/>
		{/if}

		<p class="usage">{view.usageLine}</p>
		<div class="live" role="status" aria-live="polite">{message}</div>
		{#if error}
			<p class="error" role="alert">{error}</p>
		{/if}

		{#if view.canManageCustom}
			<AiCustomEndpoints
				endpoints={customEndpoints}
				privateAllowed={registry.privateAllowed}
				onchanged={reloadRegistry}
			/>
		{/if}

		<p class="note">{t('settings.ai.note')}</p>
		<p>
			<a href="/p/journal/settings">{t('settings.ai.journalLink')}</a>
		</p>
	{/if}
</Section>

<style>
	h3 {
		margin: var(--space-4) 0 var(--space-2);
		font-size: var(--font-size-l);
		font-weight: var(--weight-strong);
	}

	.rows {
		list-style: none;
		padding: 0;
		max-width: 36rem;
	}

	.rows li {
		padding-block: var(--space-3);
	}

	.rows li + li {
		border-top: 1px solid var(--hair);
	}

	.rows p {
		margin: var(--space-1) 0;
	}

	.head {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: var(--space-1) var(--space-2);
	}

	.modelform {
		display: grid;
		gap: var(--space-2);
		margin-top: var(--space-2);
		max-width: 28rem;
	}

	.actions,
	.confirm {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
		margin-top: var(--space-1);
	}

	.banner {
		padding-inline-start: var(--space-3);
		border-inline-start: 3px solid var(--warn);
	}

	/* A warning: the text in --text, the --warn bar as the cue. */
	.warn {
		font-weight: var(--weight-strong);
		padding-inline-start: var(--space-2);
		border-inline-start: 3px solid var(--warn);
	}

	.muted,
	.usage,
	.note {
		color: var(--readable-muted);
	}

	.live {
		min-height: 1.4em;
	}

	.error {
		color: var(--readable-bad);
		padding-inline-start: var(--space-2);
		border-inline-start: 3px solid var(--bad);
	}
</style>
