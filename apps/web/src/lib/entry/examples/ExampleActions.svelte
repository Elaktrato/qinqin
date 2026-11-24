<script lang="ts">
	// Keep, delete and report one AI example (#186): a draft has Keep, a kept
	// example not. Report opens a reason picker (no keyboard on a phone) and
	// deletes with that reason. Buttons stay enabled while an action runs
	// (aria-disabled) so the focus and an Android keyboard never jump.
	import { t } from '$lib/i18n';
	import { Button, Select } from '$lib/ui';
	import { REPORT_REASONS, type ReportReason } from '$lib/api/examples';
	import { reasonLabel } from './examples';

	let {
		describedBy,
		onkeep,
		onremove
	}: {
		/** The id of the sentence the buttons act on (their description). */
		describedBy: string;
		onkeep?: () => Promise<void>;
		onremove: (reason?: ReportReason) => Promise<void>;
	} = $props();

	let busy = $state(false);
	let reporting = $state(false);
	let reason = $state<ReportReason>('missing_word');
	let reportButton = $state<HTMLElement | undefined>();
	let reasonSelect = $state<HTMLSelectElement | undefined>();

	const reasonOptions = REPORT_REASONS.map((value) => ({ value, label: reasonLabel(value) }));

	async function run(action: () => Promise<void>): Promise<void> {
		if (busy) return;
		busy = true;
		try {
			await action();
		} finally {
			busy = false;
		}
	}

	function openReport(): void {
		reporting = true;
		queueMicrotask(() => reasonSelect?.focus());
	}

	function cancelReport(): void {
		reporting = false;
		queueMicrotask(() => reportButton?.focus());
	}
</script>

<div class="actions">
	{#if !reporting}
		{#if onkeep}
			<Button variant="primary" aria-describedby={describedBy} aria-disabled={busy} onclick={() => run(onkeep)}>{t('entry.examples.keep')}</Button>
		{/if}
		<Button variant="plain" aria-describedby={describedBy} aria-disabled={busy} onclick={() => run(() => onremove())}>{t('entry.examples.delete')}</Button>
		<Button variant="plain" aria-describedby={describedBy} aria-disabled={busy} bind:element={reportButton} onclick={openReport}>{t('entry.examples.report')}</Button>
	{:else}
		<div class="report">
			<Select label={t('entry.examples.reportReason')} bind:value={reason} options={reasonOptions} bind:element={reasonSelect} />
			<div class="row">
				<Button tone="danger" aria-describedby={describedBy} aria-disabled={busy} onclick={() => run(() => onremove(reason))}>{t('entry.examples.reportSend')}</Button>
				<Button variant="plain" onclick={cancelReport}>{t('entry.examples.cancel')}</Button>
			</div>
		</div>
	{/if}
</div>

<style>
	.actions,
	.row {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		align-items: center;
	}

	.report {
		display: grid;
		gap: var(--space-2);
		width: 100%;
	}
</style>
