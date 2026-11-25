<script lang="ts">
	import { t } from '$lib/i18n';
	import { saveFile } from '$lib/native/files';
	import { Button, Panel } from '$lib/ui';
	import { recoveryClipboard, recoveryFileName, recoveryText } from './recoveryCodes';

	// The recovery codes, shown once: copy, download, and confirm they are saved.
	let {
		codes,
		site,
		oncontinue,
		continueLabel = t('common.action.continue')
	}: { codes: string[]; site: string; oncontinue: () => void; continueLabel?: string } = $props();

	let saved = $state(false);
	let copied = $state(false);
	let error = $state('');

	async function copy() {
		error = '';
		try {
			await navigator.clipboard.writeText(recoveryClipboard(codes));
			copied = true;
		} catch {
			error = t('account.recovery.copyFailed');
		}
	}

	// A browser downloads the file; the Android app opens its save screen (lib/native/files.ts).
	async function download() {
		error = '';
		const now = new Date();
		const blob = new Blob([recoveryText(codes, site, now)], { type: 'text/plain' });
		if ((await saveFile(recoveryFileName(now), 'text/plain', blob)) === 'failed') error = t('account.recovery.saveFailed');
	}
</script>

<section aria-labelledby="rc-title">
	<h2 id="rc-title" tabindex="-1">{t('account.recovery.title')}</h2>
	<p>{t('account.recovery.intro')}</p>
	<!-- Panel raised: a block of values to copy, read as one object (#106). -->
	<div class="codes-panel"><Panel raised>
		<ul class="codes">
			{#each codes as code (code)}
				<li><code>{code}</code></li>
			{/each}
		</ul>
	</Panel></div>
	<p class="row">
		<Button onclick={copy}>{copied ? t('common.action.copied') : t('common.action.copy')}</Button>
		<Button onclick={download}>{t('account.recovery.download')}</Button>
	</p>
	{#if error}<p class="error" role="alert">{error}</p>{/if}
	<label class="check">
		<input type="checkbox" bind:checked={saved} />
		{t('account.recovery.saved')}
	</label>
	<Button variant="primary" disabled={!saved} onclick={oncontinue}>{continueLabel}</Button>
</section>

<style>
	.codes-panel {
		margin-block: var(--space-3);
	}
	.codes {
		columns: 2;
		margin: 0;
		list-style: none;
		padding: 0;
		font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
		font-size: var(--font-size-m);
		line-height: var(--line-body);
	}
	.row {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
	.check {
		display: flex;
		gap: var(--space-2);
		align-items: center;
		margin-block: var(--space-3);
	}
	.error {
		margin: 0;
		padding-inline-start: var(--space-2);
		border-inline-start: 3px solid var(--bad);
		color: var(--readable-bad);
		font-weight: var(--weight-medium);
	}
</style>
