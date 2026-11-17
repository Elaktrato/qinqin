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
	import { t } from '$lib/i18n';

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
			message = t('settings.ai.custom.added');
		} catch (err) {
			const text = aiErrorView(err, 'review').text;
			if (apiErrorBody(err)?.error === 'endpoint_blocked') urlError = text;
			else error = text;
			busy = false;
			return;
		} finally {
			busy = false;
		}
		await refresh();
	}

	// The change itself succeeded; a failed reload is only a stale list.
	async function refresh(): Promise<void> {
		try {
			await onchanged();
		} catch {
			message += t('settings.ai.custom.refreshFailed');
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
			message = t('settings.ai.custom.saved');
		} catch (err) {
			error = aiErrorView(err, 'review').text;
			return;
		} finally {
			busy = false;
		}
		await refresh();
	}

	async function remove(id: string): Promise<void> {
		busy = true;
		error = message = '';
		try {
			await deleteCustomProvider(id);
			removing = null;
			message = t('settings.ai.custom.removed');
		} catch (err) {
			error = aiErrorView(err, 'review').text;
			return;
		} finally {
			busy = false;
		}
		await refresh();
	}

	async function cancelRemove(id: string): Promise<void> {
		removing = null;
		await tick();
		document.getElementById(`remove-endpoint-${id}`)?.focus();
	}
</script>

<section class="custom" aria-labelledby="custom-heading">
	<h3 id="custom-heading">{t('settings.ai.custom.title')}</h3>
	<p class="hint">
		{t('settings.ai.custom.intro')}
		{#if !privateAllowed}{t('settings.ai.custom.privateOff')}{/if}
	</p>

	{#if endpoints.length > 0}
		<ul class="endpoints" aria-label={t('settings.ai.custom.title')}>
			{#each endpoints as p (p.id)}
				<li>
					<div class="line">
						<strong>{p.name}</strong>
						<span class="muted">{p.baseUrl ?? p.host}</span>
					</div>
					{#if editing === p.id}
						<form class="editform" onsubmit={saveEdit}>
							<label>
								<span>{t('settings.ai.custom.defaultModelFor', { name: p.name })}</span>
								<input bind:value={editModel} autocomplete="off" spellcheck="false" />
							</label>
							<label class="check"><input type="checkbox" bind:checked={editVision} /> {t('settings.ai.readsPhotos')}</label>
							<label>
								<span>{t('settings.ai.custom.structuredFor', { name: p.name })}</span>
								<select bind:value={editStructured}>
									<option value="json_schema">{t('settings.ai.custom.modeSchema')}</option>
									<option value="json_object">{t('settings.ai.structured.jsonObject')}</option>
									<option value="prompt">{t('settings.ai.custom.modePrompt')}</option>
								</select>
							</label>
							<div class="actions">
								<button type="submit" disabled={busy || editModel.trim() === ''}>{t('settings.ai.custom.save')}</button>
								<button type="button" class="secondary" onclick={() => (editing = null)}>{t('common.action.cancel')}</button>
							</div>
						</form>
					{:else if removing === p.id}
						<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
						<span
							class="confirm"
							role="group"
							aria-label={t('settings.ai.custom.removeConfirmName', { name: p.name })}
							tabindex="-1"
							onkeydown={(e) => e.key === 'Escape' && cancelRemove(p.id)}
						>
							{t('settings.ai.custom.removeConfirm', { name: p.name })}
							<button type="button" class="secondary danger" onclick={() => remove(p.id)} disabled={busy}>{t('settings.ai.removeYes')}</button>
							<button type="button" class="secondary" onclick={() => cancelRemove(p.id)}>{t('common.action.cancel')}</button>
						</span>
					{:else}
						<div class="actions">
							<button type="button" class="secondary" aria-label={t('settings.ai.custom.editNamed', { name: p.name })} onclick={() => edit(p)}
								>{t('settings.ai.custom.edit')}</button
							>
							<button
								type="button"
								id={`remove-endpoint-${p.id}`}
								class="secondary danger"
								aria-label={t('settings.ai.custom.removeNamed', { name: p.name })}
								onclick={() => (removing = p.id)}
							>
								{t('common.action.remove')}
							</button>
						</div>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}

	<form class="addform" onsubmit={add}>
		<label>
			<span>{t('settings.ai.custom.name')}</span>
			<input bind:value={name} maxlength="40" autocomplete="off" />
		</label>
		<label>
			<span>{t('settings.ai.custom.baseUrl')}</span>
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
			<span>{t('settings.ai.custom.defaultModel')}</span>
			<input bind:value={defaultModel} autocomplete="off" spellcheck="false" />
		</label>
		<label class="check"><input type="checkbox" bind:checked={vision} /> {t('settings.ai.readsPhotos')}</label>
		<label class="check"><input type="checkbox" bind:checked={keyRequired} /> {t('settings.ai.custom.needsKey')}</label>
		<label>
			<span>{t('settings.ai.custom.structured')}</span>
			<select bind:value={structured}>
				<option value="json_object">{t('settings.ai.custom.modeObjectHint')}</option>
				<option value="json_schema">{t('settings.ai.custom.modeSchemaHint')}</option>
				<option value="prompt">{t('settings.ai.custom.modePrompt')}</option>
			</select>
		</label>
		<div class="actions">
			<button type="submit" disabled={!canAdd}>{busy ? t('settings.ai.add.working') : t('settings.ai.custom.add')}</button>
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
		color: var(--readable-muted);
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
		color: var(--readable-bad);
	}

	.error {
		font-weight: 600;
		margin: 0;
	}
</style>
