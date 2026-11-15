<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { deleteAiKey, getAiStatus, saveAiKey, setAiModel, type AiStatus } from '$lib/api/ai';
	import { aiErrorView } from '$lib/plugins/journal/aiErrors';
	import { aiSettingsView } from './aiSettingsView';

	const DEFAULT_MODEL = 'claude-opus-5-5';

	let status = $state<AiStatus | null>(null);
	let loadError = $state('');
	let key = $state('');
	let model = $state(DEFAULT_MODEL);
	let busy = $state(false);
	let message = $state('');
	let error = $state('');
	let confirmingRemove = $state(false);
	let removeButton = $state<HTMLButtonElement>();
	let keyInput = $state<HTMLInputElement>();

	const view = $derived(status ? aiSettingsView(status) : null);
	const storedModel = $derived(status?.key?.model ?? null);
	const modelChanged = $derived(storedModel !== null && model !== storedModel);
	const canSave = $derived(!busy && (key.trim() !== '' || modelChanged));

	function adopt(next: AiStatus): void {
		status = next;
		model = next.key?.model ?? model;
	}

	async function load(): Promise<void> {
		loadError = '';
		try {
			adopt(await getAiStatus());
		} catch {
			loadError = 'Could not load the AI settings. Try again.';
		}
	}

	onMount(() => {
		void load();
	});

	async function save(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (!canSave) return;
		busy = true;
		error = '';
		message = key.trim() !== '' ? 'Checking the key…' : 'Saving…';
		try {
			const next = key.trim() !== '' ? await saveAiKey(key.trim(), model) : await setAiModel(model);
			// Only the status is kept: the key is cleared and never read back.
			key = '';
			adopt(next);
			message = 'Saved';
		} catch (err) {
			message = '';
			error = aiErrorView(err, 'review').text;
		} finally {
			busy = false;
		}
	}

	async function remove(): Promise<void> {
		busy = true;
		error = '';
		try {
			await deleteAiKey();
			confirmingRemove = false;
			adopt(await getAiStatus());
			message = 'Key removed';
			keyInput?.focus();
		} catch (err) {
			error = aiErrorView(err, 'review').text;
		} finally {
			busy = false;
		}
	}

	function askRemove(): void {
		confirmingRemove = true;
	}

	async function cancelRemove(): Promise<void> {
		confirmingRemove = false;
		await tick();
		removeButton?.focus();
	}
</script>

<section class="ai" aria-labelledby="ai-heading">
	<h2 id="ai-heading">AI</h2>

	{#if loadError}
		<p class="error" role="alert">{loadError}</p>
		<button type="button" class="secondary" onclick={load}>Retry</button>
	{:else if !status || !view}
		<p>Loading…</p>
	{:else}
		{#if view.testProvider}
			<p><span class="badge">Test provider — no real AI</span></p>
		{/if}
		{#if view.banner}
			<p class="banner" role="status">{view.banner}</p>
		{/if}

		{#if view.keyLine}
			<p class="keyline">{view.keyLine}</p>
		{/if}
		<p class="usage">{view.usageLine}</p>

		{#if view.canAddKey}
			<form class="keyform" onsubmit={save}>
				<label>
					<span>{status.key ? 'Replace the API key' : 'Anthropic API key'}</span>
					<input
						bind:this={keyInput}
						type="password"
						autocomplete="off"
						autocapitalize="off"
						spellcheck="false"
						bind:value={key}
						placeholder={status.key ? 'Leave empty to keep the saved key' : 'sk-ant-…'}
					/>
				</label>
				<label>
					<span>Model</span>
					<select bind:value={model}>
						{#each status.models as m (m.id)}
							<option value={m.id}>{m.label}</option>
						{/each}
					</select>
				</label>
				<div class="actions">
					<button type="submit" disabled={!canSave}>{busy ? 'Working…' : 'Save'}</button>
					{#if status.key}
						{#if confirmingRemove}
							<span class="confirm" role="group" aria-label="Remove the saved key?">
								Remove the saved key?
								<button type="button" class="secondary danger" onclick={remove} disabled={busy}>
									Yes, remove
								</button>
								<button type="button" class="secondary" onclick={cancelRemove}>Cancel</button>
							</span>
						{:else}
							<button
								type="button"
								class="secondary danger"
								bind:this={removeButton}
								onclick={askRemove}
								disabled={busy}
							>
								Remove key
							</button>
						{/if}
					{/if}
				</div>
			</form>
		{/if}

		<div class="live" aria-live="polite">{message}</div>
		{#if error}
			<p class="error" role="alert">{error}</p>
		{/if}

		<p class="note">
			Your key stays on this server, encrypted. qinqin sends text to Anthropic only when you press
			Review, Ideas or Read with AI: the entry text and your correction guidance for Review; the
			words you studied in the last 30 days and the titles and opening lines of your last 10 entries
			for Ideas; the photo for Read with AI. Anthropic bills these calls to your key.
		</p>
		<p>
			<a href="/p/journal/settings">Journal settings (correction guidance, explanation language) →</a>
		</p>
	{/if}
</section>

<style>
	.keyform {
		display: grid;
		gap: 0.9rem;
		max-width: 28rem;
		margin: 1rem 0;
	}

	.keyform label {
		display: grid;
		gap: 0.3rem;
		font-weight: 600;
	}

	.keyform input,
	.keyform select {
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
		padding: 0.15rem 0.6rem;
		border: 1px solid currentColor;
		border-radius: 999px;
		font-weight: 600;
		font-size: 0.85rem;
	}

	.banner {
		padding: 0.6rem 0.75rem;
		border: 1px solid color-mix(in srgb, currentColor 35%, transparent);
		border-left: 4px solid #b26a00;
		border-radius: 0.4rem;
	}

	.keyline {
		font-weight: 600;
		margin-bottom: 0.25rem;
	}

	.usage,
	.note {
		opacity: 0.8;
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
	}
</style>
