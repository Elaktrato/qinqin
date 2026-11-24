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
	import { aiErrorView } from '$lib/features/journal/aiErrors';
	import { t } from '$lib/i18n';
	import { Button, Field, Select } from '$lib/ui';

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
							<Field
								label={t('settings.ai.custom.defaultModelFor', { name: p.name })}
								bind:value={editModel}
								autocomplete="off"
								spellcheck="false"
							/>
							<label class="check"><input type="checkbox" bind:checked={editVision} /> {t('settings.ai.readsPhotos')}</label>
							<Select
								label={t('settings.ai.custom.structuredFor', { name: p.name })}
								bind:value={editStructured}
								options={[
									{ value: 'json_schema', label: t('settings.ai.custom.modeSchema') },
									{ value: 'json_object', label: t('settings.ai.structured.jsonObject') },
									{ value: 'prompt', label: t('settings.ai.custom.modePrompt') }
								]}
							/>
							<div class="actions">
								<Button type="submit" disabled={busy || editModel.trim() === ''}>{t('settings.ai.custom.save')}</Button>
								<Button onclick={() => (editing = null)}>{t('common.action.cancel')}</Button>
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
							<Button tone="danger" onclick={() => remove(p.id)} disabled={busy}>{t('settings.ai.removeYes')}</Button>
							<Button onclick={() => cancelRemove(p.id)}>{t('common.action.cancel')}</Button>
						</span>
					{:else}
						<div class="actions">
							<Button aria-label={t('settings.ai.custom.editNamed', { name: p.name })} onclick={() => edit(p)}
								>{t('settings.ai.custom.edit')}</Button
							>
							<Button
								id={`remove-endpoint-${p.id}`}
								tone="danger"
								aria-label={t('settings.ai.custom.removeNamed', { name: p.name })}
								onclick={() => (removing = p.id)}
							>
								{t('common.action.remove')}
							</Button>
						</div>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}

	<form class="addform" onsubmit={add}>
		<Field label={t('settings.ai.custom.name')} bind:value={name} maxlength={40} autocomplete="off" />
		<Field
			label={t('settings.ai.custom.baseUrl')}
			type="url"
			bind:value={baseUrl}
			placeholder="https://llm.example.com/v1"
			autocomplete="off"
			spellcheck="false"
			error={urlError}
		/>
		<Field
			label={t('settings.ai.custom.defaultModel')}
			bind:value={defaultModel}
			autocomplete="off"
			spellcheck="false"
		/>
		<label class="check"><input type="checkbox" bind:checked={vision} /> {t('settings.ai.readsPhotos')}</label>
		<label class="check"><input type="checkbox" bind:checked={keyRequired} /> {t('settings.ai.custom.needsKey')}</label>
		<Select
			label={t('settings.ai.custom.structured')}
			bind:value={structured}
			options={[
				{ value: 'json_object', label: t('settings.ai.custom.modeObjectHint') },
				{ value: 'json_schema', label: t('settings.ai.custom.modeSchemaHint') },
				{ value: 'prompt', label: t('settings.ai.custom.modePrompt') }
			]}
		/>
		<div class="actions">
			<Button type="submit" disabled={!canAdd}>{busy ? t('settings.ai.add.working') : t('settings.ai.custom.add')}</Button>
		</div>
	</form>
	{#if message}<p class="hint">{message}</p>{/if}
	{#if error}<p class="error" role="alert">{error}</p>{/if}
</section>

<style>
	.custom {
		margin-top: var(--space-6);
	}

	h3 {
		margin: 0 0 var(--space-2);
		font-size: var(--font-size-l);
		font-weight: var(--weight-strong);
	}

	.addform,
	.editform {
		display: grid;
		gap: var(--space-3);
		max-width: 28rem;
		margin-block: var(--space-4);
	}

	label.check {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-height: var(--hit);
	}

	.endpoints {
		list-style: none;
		padding: 0;
	}

	.endpoints li {
		padding-block: var(--space-3);
	}

	.endpoints li + li {
		border-top: 1px solid var(--hair);
	}

	.line {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1) var(--space-3);
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
		gap: var(--space-2);
	}

	.error {
		color: var(--readable-bad);
		margin: 0;
	}
</style>
