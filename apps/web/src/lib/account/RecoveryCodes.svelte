<script lang="ts">
	import { t } from '$lib/i18n';
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

	function download() {
		const now = new Date();
		const blob = new Blob([recoveryText(codes, site, now)], { type: 'text/plain' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = recoveryFileName(now);
		a.click();
		URL.revokeObjectURL(url);
	}
</script>

<section aria-labelledby="rc-title">
	<h2 id="rc-title" tabindex="-1">{t('account.recovery.title')}</h2>
	<p>{t('account.recovery.intro')}</p>
	<ul class="codes">
		{#each codes as code (code)}
			<li><code>{code}</code></li>
		{/each}
	</ul>
	<p class="row">
		<button type="button" onclick={copy}>{copied ? t('common.action.copied') : t('common.action.copy')}</button>
		<button type="button" onclick={download}>{t('account.recovery.download')}</button>
	</p>
	{#if error}<p class="error" role="alert">{error}</p>{/if}
	<label class="check">
		<input type="checkbox" bind:checked={saved} />
		{t('account.recovery.saved')}
	</label>
	<button type="button" disabled={!saved} onclick={oncontinue}>{continueLabel}</button>
</section>

<style>
	.codes {
		columns: 2;
		list-style: none;
		padding: 0;
		font-size: 1.05rem;
	}
	.row {
		display: flex;
		gap: 0.5rem;
	}
	.check {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		margin: 0.75rem 0;
	}
</style>
