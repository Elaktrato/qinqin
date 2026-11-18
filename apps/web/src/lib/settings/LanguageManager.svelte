<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { t } from '$lib/i18n';
	import { ApiError } from '$lib/api/client';
	import { languageUsage, registerLanguage, removeLanguage } from '$lib/api/adminLanguages';
	import { listLanguages } from '$lib/api/languages';
	import { listPacks } from '$lib/api/packs';
	import { languageLabel } from '$lib/languages';
	import { languageRows, normalizeCode, type LanguageRow } from './languagesView';
	import { Button, Field } from '$lib/ui';

	// Admin view of every known language: where its data comes from, how
	// many workspaces use it, and registration/removal of data-only ones.
	// `refreshKey` changes when the Packs section installs or uninstalls.
	let { refreshKey = 0 }: { refreshKey?: number } = $props();

	let rows = $state<LanguageRow[]>([]);
	let loading = $state(true);
	let loadError = $state('');
	let code = $state('');
	let adding = $state(false);
	let error = $state('');
	let notice = $state('');
	let confirmCode = $state<string | null>(null);
	let confirmButton = $state<HTMLElement | undefined>(undefined);
	const removeButtons: Record<string, HTMLElement | undefined> = {};

	async function askRemove(code: string): Promise<void> {
		confirmCode = code;
		await tick();
		confirmButton?.focus();
	}

	async function cancelRemove(code: string): Promise<void> {
		confirmCode = null;
		await tick();
		removeButtons[code]?.focus();
	}
	let heading = $state<HTMLHeadingElement>();

	const normalized = $derived(normalizeCode(code));
	const preview = $derived(normalized ? languageLabel(normalized) : '');

	async function load(): Promise<void> {
		loadError = '';
		try {
			const [langs, packs, usage] = await Promise.all([listLanguages(), listPacks(), languageUsage()]);
			rows = languageRows(langs, packs, usage);
		} catch (err) {
			loadError = err instanceof ApiError ? err.message : t('settings.languages.loadFailed');
		} finally {
			loading = false;
		}
	}

	onMount(load);

	let first = true;
	$effect(() => {
		void refreshKey;
		if (first) {
			first = false;
			return;
		}
		void load();
	});

	async function add(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (adding) return;
		error = '';
		notice = '';
		if (!normalized) {
			error = t('settings.languages.invalidCode');
			return;
		}
		adding = true;
		try {
			const added = await registerLanguage(normalized);
			notice = t('settings.languages.added', { language: languageLabel(added.code), code: added.code });
			code = '';
			await load();
		} catch (err) {
			error = err instanceof ApiError ? err.message : t('settings.languages.addFailed');
		} finally {
			adding = false;
		}
	}

	async function remove(row: LanguageRow): Promise<void> {
		error = '';
		notice = '';
		try {
			await removeLanguage(row.code);
			notice = t('settings.languages.removed', { language: row.label, code: row.code });
			await load();
		} catch (err) {
			error = err instanceof ApiError ? err.message : t('settings.languages.removeFailed');
		} finally {
			confirmCode = null;
			heading?.focus();
		}
	}
</script>

<section class="languages" aria-labelledby="languages-heading">
	<h3 id="languages-heading" bind:this={heading} tabindex="-1">{t('settings.languages.title')}</h3>
	{#if loading}
		<p class="hint" aria-live="polite">{t('settings.languages.loading')}</p>
	{:else if loadError}
		<p class="error" role="alert">{loadError}</p>
		<Button onclick={load}>{t('common.action.retry')}</Button>
	{:else}
		<div class="scroll">
			<table class="ui-table">
				<thead>
					<tr>
						<th>{t('settings.languages.colLanguage')}</th>
						<th>{t('settings.languages.colCode')}</th>
						<th>{t('settings.languages.colKind')}</th>
						<th>{t('settings.languages.colPacks')}</th>
						<th>{t('settings.languages.colWorkspaces')}</th>
						<th><span class="sr-only">{t('settings.languages.colActions')}</span></th>
					</tr>
				</thead>
				<tbody>
					{#each rows as row (row.code)}
						<tr>
							<td>{row.label}</td>
							<td>
								<code>{row.code}</code>
								{#if !row.valid}<span class="flag">{t('settings.languages.invalid')}</span>{/if}
							</td>
							<td>{row.kind === 'code' ? t('settings.languages.builtIn') : t('settings.languages.dataOnly')}</td>
							<td>
								{#if row.packs.length === 0}<span class="none">{t('settings.languages.none')}</span>{/if}
								{#each row.packs as pack (pack)}<div>{pack}</div>{/each}
							</td>
							<td>{row.workspaces}</td>
							<td>
								{#if row.removable}
									{#if confirmCode === row.code}
										<Button tone="danger" bind:element={confirmButton} onclick={() => remove(row)}>
											{t('settings.languages.confirmRemove', { language: row.label })}
										</Button>
										<Button onclick={() => cancelRemove(row.code)}>{t('common.action.cancel')}</Button>
									{:else}
										<Button
											bind:element={removeButtons[row.code]}
											onclick={() => askRemove(row.code)}
											aria-label={t('settings.languages.removeLabel', { language: row.label, code: row.code })}
										>
											{t('common.action.remove')}
										</Button>
									{/if}
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}

	<form class="add" onsubmit={add}>
		<h4>{t('settings.languages.add')}</h4>
		<Field
			label={t('settings.languages.code')}
			id="language-code"
			bind:value={code}
			autocomplete="off"
			spellcheck="false"
			maxlength={20}
			placeholder={t('settings.languages.codePlaceholder')}
			aria-describedby="language-code-help"
		/>
		<p id="language-code-help" class="hint">
			{t('settings.languages.codeHelp')}
			{#if preview}<strong>{preview}</strong>{/if}
		</p>
		<p class="hint">{t('settings.languages.addHint')}</p>
		<Button type="submit" disabled={!normalized} busy={adding}>
			{adding ? t('settings.languages.adding') : t('settings.languages.addSubmit')}
		</Button>
	</form>
	{#if notice}<p class="hint" role="status">{notice}</p>{/if}
	{#if error}<p class="error" role="alert">{error}</p>{/if}
</section>

<style>
	.languages {
		margin-top: var(--space-6);
		display: grid;
		gap: var(--space-2);
	}

	h3,
	h4 {
		margin: 0;
	}

	h3 {
		font-size: var(--font-size-l);
		font-weight: var(--weight-strong);
	}

	h4 {
		font-size: var(--font-size-label);
		font-weight: var(--weight-strong);
	}

	.scroll {
		overflow-x: auto;
	}

	.flag {
		margin-left: var(--space-1);
		font-size: var(--font-size-label);
		color: var(--readable-bad);
		font-weight: var(--weight-strong);
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
	}

	.none {
		color: var(--readable-muted);
	}

	.add {
		display: grid;
		gap: var(--space-1);
		max-width: 28rem;
	}

	.hint {
		margin: 0;
		color: var(--readable-muted);
	}

	.error {
		margin: 0;
		color: var(--readable-bad);
		padding-inline-start: var(--space-2);
		border-inline-start: 3px solid var(--bad);
	}
</style>
