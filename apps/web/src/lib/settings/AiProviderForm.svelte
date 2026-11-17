<script lang="ts">
	import type { ProviderInfo } from '$lib/api/ai';
	import { t } from '$lib/i18n';
	import { modelSuggestions, privacyNote } from './aiSettingsView';

	let {
		builtin,
		custom,
		busy,
		onsave
	}: {
		builtin: ProviderInfo[];
		custom: ProviderInfo[];
		busy: boolean;
		/** Stores the key; resolves when done (also on failure: the form clears the key either way). */
		onsave: (provider: string, key: string, model: string) => Promise<void>;
	} = $props();

	let selectedId = $state('');
	let key = $state('');
	let model = $state('');
	let working = $state(false);

	const provider = $derived([...builtin, ...custom].find((p) => p.id === selectedId));
	const needsKey = $derived(provider ? provider.keyRequired : true);
	const canSave = $derived(
		!busy && !working && provider !== undefined && model.trim() !== '' && (!needsKey || key.trim() !== '')
	);

	function choose(event: Event): void {
		selectedId = (event.currentTarget as HTMLSelectElement).value;
		const p = [...builtin, ...custom].find((x) => x.id === selectedId);
		model = p?.defaultModel ?? '';
		key = '';
	}

	async function submit(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (!canSave || !provider) return;
		const sent = key.trim();
		working = true;
		try {
			await onsave(provider.id, sent, model.trim());
		} finally {
			// The key is never kept, whether the save worked or not.
			key = '';
			working = false;
		}
	}
</script>

{#if builtin.length + custom.length > 0}
	<form class="addform" onsubmit={submit} autocomplete="off">
		<h3>{t('settings.ai.add.title')}</h3>
		<label>
			<span>{t('settings.ai.add.provider')}</span>
			<select value={selectedId} onchange={choose}>
				<option value="">{t('settings.ai.add.choose')}</option>
				{#if builtin.length > 0}
					<optgroup label={t('settings.ai.add.builtIn')}>
						{#each builtin as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
					</optgroup>
				{/if}
				{#if custom.length > 0}
					<optgroup label={t('settings.ai.add.byAdmin')}>
						{#each custom as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
					</optgroup>
				{/if}
			</select>
		</label>

		{#if provider}
			<p class="privacy" data-testid="privacy-note" aria-live="polite">{privacyNote(provider.name)}</p>
			{#if provider.custom && provider.host}
				<p class="admin-line">{t('settings.ai.adminLine', { host: provider.host })}</p>
			{/if}
			<label>
				<span>{t('settings.ai.add.apiKey')}</span>
				<!-- An API key, not a login: keep password managers from filling the account password. -->
				<input
					type="password"
					autocomplete="new-password"
					data-1p-ignore
					data-lpignore="true"
					data-bwignore
					data-form-type="other"
					autocapitalize="off"
					spellcheck="false"
					bind:value={key}
					aria-describedby={needsKey ? undefined : 'key-optional'}
				/>
			</label>
			{#if !needsKey}
				<p id="key-optional" class="hint">{t('settings.ai.add.keyOptional')}</p>
			{/if}
			{#if provider.keyUrl}
				<p class="hint">
					<a href={provider.keyUrl} target="_blank" rel="noopener noreferrer">{t('settings.ai.add.getKey', { name: provider.name })}</a>
				</p>
			{/if}
			<label>
				<span>{t('settings.ai.add.model')}</span>
				<input list="ai-add-models" bind:value={model} autocomplete="off" spellcheck="false" />
			</label>
			<datalist id="ai-add-models">
				{#each modelSuggestions(provider) as m (m.id)}<option value={m.id}>{m.label}</option>{/each}
			</datalist>
			<div class="actions">
				<button type="submit" disabled={!canSave}>{working ? t('settings.ai.add.working') : t('common.action.save')}</button>
			</div>
		{/if}
	</form>
{/if}

<style>
	.addform {
		display: grid;
		gap: 0.9rem;
		max-width: 28rem;
		margin: 1rem 0;
	}

	h3 {
		margin: 0;
	}

	label {
		display: grid;
		gap: 0.3rem;
		font-weight: 600;
	}

	input,
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

	button {
		min-height: 2.75rem;
		min-width: 2.75rem;
	}

	.privacy,
	.hint,
	.admin-line {
		margin: 0;
		color: var(--readable-muted);
	}

	.admin-line {
		font-weight: 600;
	}
</style>
