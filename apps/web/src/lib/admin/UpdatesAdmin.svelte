<script lang="ts">
	import { onMount } from 'svelte';
	import { errorText } from '$lib/api/apiErrors';
	import { checkUpdateNow, getUpdateStatus, patchUpdateSettings, type UpdateStatus } from '$lib/api/adminUpdate';
	import { t } from '$lib/i18n';
	import { formatDateTime } from '$lib/i18n/format';
	import { Button, Section } from '$lib/ui';
	import { canCheck, errorNote, safeReleaseUrl, statusLine } from './updateView';

	let status = $state<UpdateStatus | null>(null);
	let error = $state('');
	let saved = $state(false);
	let busy = $state(false);

	async function run(call: () => Promise<UpdateStatus>, failure: string, announce = false): Promise<void> {
		busy = true;
		error = '';
		saved = false;
		try {
			status = await call();
			saved = announce;
		} catch (err) {
			error = errorText(err, failure);
		} finally {
			busy = false;
		}
	}

	onMount(() => void run(getUpdateStatus, t('admin.update.loadError')));

	const url = $derived(status?.check.latest ? safeReleaseUrl(status.check.latest.url) : null);
</script>

<Section title={t('admin.update.title')}>
	{#if error}<p class="error" role="alert">{error}</p>{/if}
	{#if status}
		<dl class="facts">
			<dt>{t('admin.update.installed')}</dt>
			<dd>{status.installed.version}</dd>
			{#if status.installed.commit}
				<dt>{t('admin.update.commit')}</dt>
				<dd><code>{status.installed.commit.slice(0, 12)}</code></dd>
			{/if}
			{#if status.installed.buildDate}
				<dt>{t('admin.update.buildDate')}</dt>
				<dd>{formatDateTime(status.installed.buildDate)}</dd>
			{/if}
			<dt>{t('admin.update.latest')}</dt>
			<dd>{status.check.latest ? status.check.latest.version : t('admin.update.none')}</dd>
		</dl>

		<p class="line" data-state={status.check.update} aria-live="polite">{statusLine(status)}</p>
		{#if errorNote(status)}<p class="hint" role="status">{errorNote(status)}</p>{/if}
		{#if status.check.checkedAt}
			<p class="hint">{t('admin.update.checkedAt', { when: formatDateTime(status.check.checkedAt) })}</p>
		{/if}

		<Button disabled={!canCheck(status, busy)} onclick={() => run(checkUpdateNow, t('admin.update.loadError'))}
			>{busy ? t('admin.update.checking') : t('admin.update.checkNow')}</Button
		>

		{#if status.check.latest?.notes}
			<h3>{t('admin.update.notes')}</h3>
			<pre class="notes">{status.check.latest.notes}</pre>
		{/if}
		{#if url}<p><a href={url} rel="noopener noreferrer">{t('admin.update.openRelease')}</a></p>{/if}

		<fieldset>
			<label class="choice">
				<input
					type="checkbox"
					checked={status.settings.enabled}
					disabled={busy}
					onchange={(e) => run(() => patchUpdateSettings({ enabled: e.currentTarget.checked }), t('admin.update.saveError'), true)}
				/>
				<span>{t('admin.update.enabled')} <span class="hint">{t('admin.update.enabledHint')}</span></span>
			</label>
			<label class="choice">
				<input
					type="checkbox"
					checked={status.settings.prereleases}
					disabled={busy || !status.settings.enabled}
					onchange={(e) => run(() => patchUpdateSettings({ prereleases: e.currentTarget.checked }), t('admin.update.saveError'), true)}
				/>
				<span>{t('admin.update.prereleases')}</span>
			</label>
		</fieldset>
		{#if saved}<p class="hint" role="status">{t('admin.update.saved')}</p>{/if}
		<p class="hint">{t('admin.update.howTo')}</p>
	{/if}
</Section>

<style>
	.facts {
		display: grid;
		grid-template-columns: max-content 1fr;
		gap: var(--space-1, 0.25rem) var(--space-3, 1rem);
	}
	dd {
		margin: 0;
	}
	.line[data-state='available'] {
		font-weight: 600;
	}
	.notes {
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		max-height: 24rem;
		overflow: auto;
		font: inherit;
	}
	.choice {
		display: flex;
		gap: var(--space-2, 0.5rem);
		align-items: flex-start;
	}
</style>
