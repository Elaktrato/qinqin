<script lang="ts">
	import { tick } from 'svelte';
	import {
		createCustomProvider,
		deleteCustomProvider,
		updateCustomProvider,
		type ProviderInfo,
		type Structured
	} from '$lib/api/ai';
	import { apiErrorBody } from '$lib/api/client';
	import { aiErrorView } from '$lib/plugins/journal/aiErrors';

	let {
		endpoints,
		privateAllowed,
		onchanged
	}: {
		endpoints: ProviderInfo[];
		privateAllowed: boolean;
		/** Called after the list changed so the page reloads the registry. */
		onchanged: () => Promise<void>;
	} = $props();

	let name = $state('');
	let baseUrl = $state('');
	let defaultModel = $state('');
	let vision = $state(false);
	let keyRequired = $state(true);
	let structured = $state<Structured>('json_object');
	let busy = $state(false);
	let urlError = $state('');
	let error = $state('');
	let message = $state('');

	let editing = $state<string | null>(null);
	let editModel = $state('');
	let editVision = $state(false);
	let editStructured = $state<Structured>('json_object');
	let removing = $state<string | null>(null);

	const canAdd = $derived(!busy && name.trim() !== '' && baseUrl.trim() !== '' && defaultModel.trim() !== '');

	async function add(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (!canAdd) return;
		busy = true;
		urlError = error = message = '';
		try {
			await createCustomProvider({
				name: name.trim(),
				baseUrl: baseUrl.trim(),
				defaultModel: defaultModel.trim(),
				vision,
				keyRequired,
				structured
			});
			name = baseUrl = defaultModel = '';
			vision = false;
			keyRequired = true;
			message = 'Endpoint added';
			await onchanged();
		} catch (err) {
			const text = aiErrorView(err, 'review').text;
			if (apiErrorBody(err)?.error === 'endpoint_blocked') urlError = text;
			else error = text;
		} finally {
			busy = false;
		}
	}

	function edit(p: ProviderInfo): void {
		editing = p.id;
		editModel = p.defaultModel;
		editVision = p.vision;
		editStructured = p.structured;
	}

	async function saveEdit(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (!editing) return;
		busy = true;
		error = message = '';
		try {
			await updateCustomProvider(editing, {
				defaultModel: editModel.trim(),
				vision: editVision,
				structured: editStructured
			});
			editing = null;
			message = 'Endpoint saved';
			await onchanged();
		} catch (err) {
			error = aiErrorView(err, 'review').text;
		} finally {
			busy = false;
		}
	}

	async function remove(id: string): Promise<void> {
		busy = true;
		error = message = '';
		try {
			await deleteCustomProvider(id);
			removing = null;
			message = 'Endpoint removed, with everyone’s keys for it';
			await onchanged();
		} catch (err) {
			error = aiErrorView(err, 'review').text;
		} finally {
			busy = false;
		}
	}

	async function cancelRemove(id: string): Promise<void> {
		removing = null;
		await tick();
		document.getElementById(`remove-endpoint-${id}`)?.focus();
	}
</script>

<section class="custom" aria-labelledby="custom-heading">
	<h3 id="custom-heading">Custom endpoints</h3>
	<p class="hint">
		Add an OpenAI-compatible endpoint (Ollama, LM Studio, vLLM, a company gateway…). Everyone on this
		server can then store their own key for it. The address, name and key setting cannot be changed
		later; remove the endpoint and add it again instead.
		{#if !privateAllowed}Private network addresses are off on this server
			(QINQIN_AI_ALLOW_PRIVATE).{/if}
	</p>

	{#if endpoints.length > 0}
		<ul class="endpoints" aria-label="Custom endpoints">
			{#each endpoints as p (p.id)}
				<li>
					<div class="line">
						<strong>{p.name}</strong>
						<span class="muted">{p.baseUrl ?? p.host}</span>
					</div>
					{#if editing === p.id}
						<form class="editform" onsubmit={saveEdit}>
							<label>
								<span>Default model for {p.name}</span>
								<input bind:value={editModel} autocomplete="off" spellcheck="false" />
							</label>
							<label class="check"><input type="checkbox" bind:checked={editVision} /> Reads photos</label>
							<label>
								<span>Structured mode for {p.name}</span>
								<select bind:value={editStructured}>
									<option value="json_schema">JSON schema</option>
									<option value="json_object">JSON mode</option>
									<option value="prompt">Prompt only</option>
								</select>
							</label>
							<div class="actions">
								<button type="submit" disabled={busy || editModel.trim() === ''}>Save endpoint</button>
								<button type="button" class="secondary" onclick={() => (editing = null)}>Cancel</button>
							</div>
						</form>
					{:else if removing === p.id}
						<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
						<span
							class="confirm"
							role="group"
							aria-label={`Remove the ${p.name} endpoint?`}
							tabindex="-1"
							onkeydown={(e) => e.key === 'Escape' && cancelRemove(p.id)}
						>
							Remove {p.name} and everyone’s keys for it?
							<button type="button" class="secondary danger" onclick={() => remove(p.id)} disabled={busy}>Yes, remove</button>
							<button type="button" class="secondary" onclick={() => cancelRemove(p.id)}>Cancel</button>
						</span>
					{:else}
						<div class="actions">
							<button type="button" class="secondary" aria-label={`Edit ${p.name}`} onclick={() => edit(p)}>Edit</button>
							<button
								type="button"
								id={`remove-endpoint-${p.id}`}
								class="secondary danger"
								aria-label={`Remove ${p.name} endpoint`}
								onclick={() => (removing = p.id)}
							>
								Remove
							</button>
						</div>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}

	<form class="addform" onsubmit={add}>
		<label>
			<span>Name</span>
			<input bind:value={name} maxlength="40" autocomplete="off" />
		</label>
		<label>
			<span>Base URL</span>
			<input
				type="url"
				bind:value={baseUrl}
				placeholder="https://llm.example.com/v1"
				autocomplete="off"
				spellcheck="false"
				aria-invalid={urlError ? 'true' : undefined}
				aria-describedby={urlError ? 'custom-url-error' : undefined}
			/>
		</label>
		{#if urlError}<p id="custom-url-error" class="error" role="alert">{urlError}</p>{/if}
		<label>
			<span>Default model</span>
			<input bind:value={defaultModel} autocomplete="off" spellcheck="false" />
		</label>
		<label class="check"><input type="checkbox" bind:checked={vision} /> Reads photos</label>
		<label class="check"><input type="checkbox" bind:checked={keyRequired} /> Needs an API key</label>
		<label>
			<span>Structured mode</span>
			<select bind:value={structured}>
				<option value="json_object">JSON mode (works almost everywhere)</option>
				<option value="json_schema">JSON schema (if the endpoint supports it)</option>
				<option value="prompt">Prompt only</option>
			</select>
		</label>
		<div class="actions">
			<button type="submit" disabled={!canAdd}>{busy ? 'Working…' : 'Add endpoint'}</button>
		</div>
	</form>
	{#if message}<p class="hint">{message}</p>{/if}
	{#if error}<p class="error" role="alert">{error}</p>{/if}
</section>

<style>
	.custom {
		margin-top: 1.5rem;
	}

	h3 {
		margin: 0 0 0.5rem;
	}

	.addform,
	.editform {
		display: grid;
		gap: 0.9rem;
		max-width: 28rem;
		margin: 1rem 0;
	}

	label {
		display: grid;
		gap: 0.3rem;
		font-weight: 600;
	}

	label.check {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-height: 2.75rem;
	}

	input:not([type='checkbox']),
	select {
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

	input[type='checkbox'] {
		width: 1.4rem;
		height: 1.4rem;
	}

	.endpoints {
		list-style: none;
		padding: 0;
		display: grid;
		gap: 0.75rem;
	}

	.endpoints li {
		padding: 0.6rem 0.75rem;
		border: 1px solid color-mix(in srgb, currentColor 25%, transparent);
		border-radius: 0.5rem;
	}

	.line {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 0.75rem;
		align-items: baseline;
	}

	.muted,
	.hint {
		opacity: 0.8;
		overflow-wrap: anywhere;
	}

	.actions,
	.confirm {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem 0.75rem;
	}

	button {
		min-height: 2.75rem;
		min-width: 2.75rem;
	}

	button.secondary {
		border: 1px solid color-mix(in srgb, currentColor 35%, transparent);
		background: transparent;
		color: inherit;
		font-weight: 500;
	}

	button.secondary.danger,
	.error {
		color: #c62828;
	}

	.error {
		font-weight: 600;
		margin: 0;
	}

	@media (prefers-color-scheme: dark) {
		button.secondary.danger,
		.error {
			color: #ff8a80;
		}
	}
</style>
