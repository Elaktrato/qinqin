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
	import AiCustomEndpoints from './AiCustomEndpoints.svelte';
	import AiProviderForm from './AiProviderForm.svelte';
	import { aiSettingsView, modelSuggestions } from './aiSettingsView';

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
			loadError = 'Could not load the AI settings. Try again.';
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
		await act(key !== '' ? 'Checking the key…' : 'Saving…', 'Saved', () => saveAiKey(provider, key, model));
	}

	async function makeActive(id: string): Promise<void> {
		await act('Changing the active provider…', 'Active provider changed', () => setActiveProvider(id));
	}

	async function testKey(id: string): Promise<void> {
		await act('Testing the key…', 'The key works', () => testAiKey(id));
	}

	async function remove(id: string): Promise<void> {
		const ok = await act('Removing the key…', 'Key removed', async () => {
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
		const ok = await act('Saving the model…', 'Model saved', () => setAiModel(id, modelDraft.trim()));
		if (ok) editingModel = null;
	}

	/** Reloads after the endpoint list changed; the caller handles a failure. */
	async function reloadRegistry(): Promise<void> {
		[status, registry] = await Promise.all([getAiStatus(), getAiProviders()]);
	}

	const customEndpoints = $derived(registry ? registry.providers.filter((p) => p.custom) : []);
</script>

<section class="ai" aria-labelledby="ai-heading">
	<h2 id="ai-heading">AI</h2>

	{#if loadError}
		<p class="error" role="alert">{loadError}</p>
		<button type="button" class="secondary" onclick={load}>Retry</button>
	{:else if !status || !registry || !view}
		<p>Loading…</p>
	{:else}
		{#if view.testProvider}
			<p><span class="badge">Test provider — no real AI</span></p>
		{/if}
		{#if view.banner}
			<p class="banner">{view.banner}</p>
		{/if}

		{#if view.rows.length > 0}
			<h3>Your providers</h3>
			<ul class="rows" aria-label="Your providers">
				{#each view.rows as row (row.id)}
					<li class:active={row.active}>
						<div class="head">
							<strong>{row.name}</strong>
							{#if row.active}<span class="badge active-badge">Active</span>{/if}
							<span class="muted">key {row.hint}</span>
						</div>
						{#if row.adminLine}<p class="muted">{row.adminLine}</p>{/if}
						{#if row.state === 'disabled'}
							<p class="warn">{row.stateText}</p>
						{:else}
							<p class="muted">
								<span>{row.modelLabel}</span>
								{#if row.vision}<span class="badge">Reads photos</span>{/if}
								{#if row.structuredLabel}<span class="badge">{row.structuredLabel}</span>{/if}
							</p>
							{#if row.stateText}<p class="warn">{row.stateText}</p>{/if}
						{/if}

						{#if editingModel === row.id}
							{@const prov = registry.providers.find((p) => p.id === row.id)}
							<form class="modelform" onsubmit={(e) => saveModel(e, row.id)}>
								<label>
									<span>Model for {row.name}</span>
									<input
										list={`models-${row.id}`}
										bind:value={modelDraft}
										autocomplete="off"
										spellcheck="false"
									/>
								</label>
								<datalist id={`models-${row.id}`}>
									{#each modelSuggestions(prov) as m (m.id)}<option value={m.id}>{m.label}</option>{/each}
								</datalist>
								<div class="actions">
									<button type="submit" disabled={busy || modelDraft.trim() === ''}>Save model</button>
									<button type="button" class="secondary" onclick={() => (editingModel = null)}>Cancel</button>
								</div>
							</form>
						{:else if confirmingRemove === row.id}
							<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
							<span
								class="confirm"
								role="group"
								aria-label={`Remove the ${row.name} key?`}
								tabindex="-1"
								onkeydown={(e) => e.key === 'Escape' && cancelRemove(row.id)}
							>
								Remove the {row.name} key?
								<button type="button" class="secondary danger" onclick={() => remove(row.id)} disabled={busy}>
									Yes, remove
								</button>
								<button type="button" class="secondary" onclick={() => cancelRemove(row.id)}>Cancel</button>
							</span>
						{:else}
							<div class="actions">
								{#if row.state !== 'disabled'}
									{#if !row.active && row.state === 'ok'}
										<button type="button" class="secondary" aria-label={`Make ${row.name} active`} disabled={busy} onclick={() => makeActive(row.id)}>
											Make active
										</button>
									{/if}
									{#if row.state === 'ok'}
										<button type="button" class="secondary" aria-label={`Test ${row.name} key`} disabled={busy} onclick={() => testKey(row.id)}>
											Test key
										</button>
									{/if}
									<button type="button" class="secondary" aria-label={`Change ${row.name} model`} disabled={busy} onclick={() => startModel(row.id, row.model)}>
										Change model
									</button>
								{/if}
								<button
									type="button"
									id={`remove-${row.id}`}
									class="secondary danger"
									aria-label={`Remove ${row.name} key`}
									disabled={busy}
									onclick={() => (confirmingRemove = row.id)}
								>
									Remove
								</button>
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

		<p class="note">
			Your keys stay on this server, encrypted. qinqin sends text to the provider you made active
			only when you press Review, Ideas or Read with AI: the entry text and your correction
			guidance for Review; the words you studied in the last 30 days and the titles and opening
			lines of your last 10 entries for Ideas; the photo for Read with AI. The provider bills these
			calls to your key.
		</p>
		<p>
			<a href="/p/journal/settings">Journal settings (correction guidance, explanation language) →</a>
		</p>
	{/if}
</section>

<style>
	h3 {
		margin: 1rem 0 0.5rem;
	}

	.rows {
		list-style: none;
		padding: 0;
		display: grid;
		gap: 0.75rem;
		max-width: 36rem;
	}

	.rows li {
		padding: 0.6rem 0.75rem;
		border: 1px solid color-mix(in srgb, currentColor 25%, transparent);
		border-radius: 0.5rem;
	}

	.rows li.active {
		border-color: currentColor;
	}

	.rows p {
		margin: 0.3rem 0;
	}

	.head {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.25rem 0.6rem;
	}

	.modelform {
		display: grid;
		gap: 0.6rem;
		margin-top: 0.5rem;
	}

	.modelform label {
		display: grid;
		gap: 0.3rem;
		font-weight: 600;
	}

	.modelform input {
		font: inherit;
		font-weight: 400;
		min-height: 2.75rem;
		padding: 0.4rem 0.6rem;
		border: 1px solid color-mix(in srgb, currentColor 35%, transparent);
		border-radius: 0.4rem;
		background: transparent;
		color: inherit;
		box-sizing: border-box;
		width: 100%;
	}

	.actions,
	.confirm {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem 0.75rem;
		margin-top: 0.4rem;
	}

	.ai button {
		min-height: 2.75rem;
		min-width: 2.75rem;
	}

	.ai button.secondary {
		border: 1px solid color-mix(in srgb, currentColor 35%, transparent);
		background: transparent;
		color: inherit;
		font-weight: 500;
	}

	.ai button.secondary.danger {
		color: #c62828;
	}

	.badge {
		display: inline-block;
		padding: 0.1rem 0.55rem;
		border: 1px solid currentColor;
		border-radius: 999px;
		font-weight: 600;
		font-size: 0.8rem;
	}

	.banner {
		padding: 0.6rem 0.75rem;
		border: 1px solid color-mix(in srgb, currentColor 35%, transparent);
		border-left: 4px solid #b26a00;
		border-radius: 0.4rem;
	}

	.warn {
		font-weight: 600;
		color: #b26a00;
	}

	.muted,
	.usage,
	.note {
		opacity: 0.85;
	}

	.live {
		min-height: 1.4em;
	}

	.error {
		color: #c62828;
		font-weight: 600;
	}

	@media (prefers-color-scheme: dark) {
		.ai button.secondary.danger,
		.error {
			color: #ff8a80;
		}

		.banner {
			border-left-color: #ffb74d;
		}

		.warn {
			color: #ffb74d;
		}
	}
</style>
