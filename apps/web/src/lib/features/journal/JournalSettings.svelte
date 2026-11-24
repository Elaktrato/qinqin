<script lang="ts">
	import { errorText } from '$lib/api/apiErrors';
	import { plainText } from './editorLogic';
	import { t } from '$lib/i18n';
	import { formatNumber } from '$lib/i18n/format';
	import { onMount } from 'svelte';
	import type { Workspace } from '$lib/api/types';
	import { codePoints } from './entryDraft';
	import { EXPLANATION_LANGUAGES } from './languages';
	import { journalHref } from './route';
	import { getJournalSettings, saveJournalSettings } from './store';
	import { Button, Field, Select } from '$lib/ui';

	let { workspace }: { workspace: Workspace } = $props();

	const MAX_GUIDANCE = 2000;

	let guidance = $state('');
	let language = $state('en');
	let loading = $state(true);
	let saving = $state(false);
	let status = $state('');
	let error = $state('');
	let heading = $state<HTMLHeadingElement>();

	const count = $derived(codePoints(guidance));
	const tooLong = $derived(count > MAX_GUIDANCE);

	onMount(async () => {
		try {
			const s = await getJournalSettings(workspace.id);
			guidance = s.guidance;
			language = s.explanationLanguage;
		} catch {
			error = t('journal.settings.loadFailed');
		} finally {
			loading = false;
		}
		heading?.focus();
	});

	async function save(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (saving || tooLong) return;
		saving = true;
		error = '';
		status = t('journal.save.saving');
		try {
			// The server refuses control characters (a pasted vertical tab): send what it takes.
			await saveJournalSettings(workspace.id, { guidance: plainText(guidance), explanationLanguage: language });
			status = t('journal.save.saved');
		} catch (err) {
			status = '';
			error = errorText(err, t('journal.settings.saveFailed'));
		} finally {
			saving = false;
		}
	}
</script>

<p><a href={journalHref({ view: 'list' })}>{t('journal.settings.back')}</a></p>
<h1 bind:this={heading} tabindex="-1">{t('journal.settings.title', { name: workspace.name })}</h1>

{#if loading}
	<p role="status">{t('common.loading')}</p>
{:else}
	<form onsubmit={save}>
		<Field
			label={t('journal.settings.guidance')}
			multiline
			bind:value={guidance}
			aria-describedby="guidance-help guidance-count"
			placeholder={t('journal.settings.placeholder')}
		/>
		<p id="guidance-help" class="hint">
			{t('journal.settings.guidanceHint')}
		</p>
		<p id="guidance-count" class:error={tooLong}>
			{t('journal.settings.count', { count: formatNumber(count), max: formatNumber(MAX_GUIDANCE) })}
		</p>

		<Select
			label={t('journal.settings.language')}
			bind:value={language}
			options={EXPLANATION_LANGUAGES.map((l) => ({ value: l.code, label: l.label }))}
		/>

		<div class="bar">
			<Button type="submit" variant="primary" disabled={saving || tooLong}>{t('journal.settings.save')}</Button>
			<span class="live" aria-live="polite">{status}</span>
		</div>
		{#if error}<p class="error" role="alert">{error}</p>{/if}
	</form>

	<p><a href="/settings?tab=ai">{t('journal.settings.aiLink')}</a></p>
{/if}

<style>
	h1:focus {
		outline: none;
	}

	form {
		display: grid;
		gap: var(--space-2);
		max-width: 34rem;
	}

	form :global(textarea) {
		min-height: 9rem;
	}

	p {
		margin: 0.25rem 0;
	}

	.hint {
		color: var(--readable-muted);
	}

	.error {
		color: var(--readable-bad);
		padding-inline-start: var(--space-2);
		border-inline-start: 3px solid var(--bad);
	}

	.bar {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}
</style>
