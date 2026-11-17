<script lang="ts">
	import { onDestroy, tick } from 'svelte';
	import { apiErrorBody } from '$lib/api/client';
	import {
		applyRestore, discardRestore, downloadMyData, restoreStatus, safetyExportTicket, uploadRestore
	} from '$lib/api/backup';
	import { user } from '$lib/auth';
	import { t } from '$lib/i18n';
	import Msg from '$lib/i18n/Msg.svelte';
	import {
		canApply, clearLocalAfterRestore, errorText, formatBytes, needsDropAck, nextPollDelay, replaceSentence,
		restoreSentence, stageProblem, unresolvedLines, type StageView
	} from './backupView';

	// Settings -> Account -> Your data: download everything you own, or
	// replace it all from such a download. The restore is staged (uploaded
	// and checked first), then confirmed with the password.
	let {
		reload = () => location.reload(),
		assign = (u: string) => location.assign(u),
		storage = typeof localStorage === 'undefined' ? null : localStorage
	}: { reload?: () => void; assign?: (url: string) => void; storage?: Pick<Storage, 'getItem' | 'removeItem'> | null } = $props();

	let heading = $state<HTMLHeadingElement | null>(null);
	let error = $state('');
	let busy = $state(false);
	let progress = $state<number | null>(null);
	let token = $state('');
	let view = $state<StageView | null>(null);
	let ackDrop = $state(false);
	let password = $state('');
	let code = $state('');
	let typed = $state('');
	let droppedReviews = $state(0);
	let timer: ReturnType<typeof setTimeout> | undefined;
	let polls = 0;

	const username = $derived($user?.username ?? '');
	const hasTotp = $derived(!!$user?.mfa?.totp);
	const ok = $derived(
		canApply({ status: view?.status ?? 'invalid', report: view?.report ?? null, ackDrop, password, hasTotp, code, typed, username, busy })
	);

	async function focusHeading(): Promise<void> {
		await tick();
		heading?.focus();
	}

	async function download(): Promise<void> {
		busy = true;
		error = '';
		try {
			await downloadMyData(assign);
		} catch (err) {
			const b = apiErrorBody(err);
			error = errorText(b?.error, t('account.data.downloadFailed'));
		} finally {
			busy = false;
		}
	}

	function stopPolling(): void {
		if (timer) clearTimeout(timer);
		timer = undefined;
	}

	async function poll(): Promise<void> {
		try {
			view = await restoreStatus(token);
		} catch (err) {
			const b = apiErrorBody(err);
			error = errorText(b?.error, t('account.data.statusFailed'));
			view = null;
			return;
		}
		if (view.status === 'validating' || view.status === 'running') {
			timer = setTimeout(poll, nextPollDelay(polls++));
			return;
		}
		if (view.status === 'done') {
			droppedReviews = storage ? clearLocalAfterRestore(storage) : 0;
			try {
				if (typeof caches !== 'undefined') for (const k of await caches.keys()) await caches.delete(k);
			} catch {
				// no cache storage: nothing to clear
			}
			timer = setTimeout(reload, 6000);
		}
		await focusHeading();
	}

	async function pick(event: Event): Promise<void> {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		stopPolling();
		error = '';
		view = null;
		ackDrop = false;
		busy = true;
		progress = 0;
		try {
			const out = await uploadRestore(file, (p) => (progress = p.total ? Math.round((p.loaded / p.total) * 100) : 0));
			token = out.token;
			polls = 0;
			progress = null;
			await poll();
		} catch (err) {
			progress = null;
			const b = apiErrorBody(err);
			error = errorText(b?.error, t('account.data.uploadFailed'));
		} finally {
			busy = false;
		}
	}

	async function safety(): Promise<void> {
		error = '';
		try {
			assign((await safetyExportTicket()).url);
		} catch (err) {
			const b = apiErrorBody(err);
			error = errorText(b?.error, t('account.data.noEarlier'));
		}
	}

	async function downloadCurrent(): Promise<void> {
		await download();
	}

	async function restore(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (!ok) return;
		busy = true;
		error = '';
		try {
			await applyRestore(token, { confirm: typed, password, code: code.trim() || undefined, unresolved: ackDrop ? 'drop' : undefined });
			password = '';
			code = '';
			polls = 0;
			view = view ? { ...view, status: 'running' } : view;
			timer = setTimeout(poll, 1000);
			await focusHeading();
		} catch (err) {
			const b = apiErrorBody(err);
			error = errorText(b?.error, t('account.data.restoreFailed'));
		} finally {
			busy = false;
		}
	}

	async function cancel(): Promise<void> {
		stopPolling();
		try {
			await discardRestore(token);
		} catch {
			// the stage expires on its own
		}
		view = null;
		token = '';
		await focusHeading();
	}

	onDestroy(stopPolling);
</script>

<section aria-labelledby="account-data-heading" class="block">
	<h2 id="account-data-heading" tabindex="-1" bind:this={heading}>{t('account.data.title')}</h2>
	<p class="hint">{t('account.data.downloadHint')}</p>
	<button type="button" disabled={busy} onclick={download}>{t('account.data.download')}</button>
	<p class="hint">
		<Msg key="account.data.lookupsHint">{#snippet link(text: string)}<a href="/lookups">{text}</a>{/snippet}</Msg>
	</p>

	<h3>{t('account.data.restoreTitle')}</h3>
	<p class="hint">
		<Msg key="account.data.restoreHint">{#snippet strong(text: string)}<strong>{text}</strong>{/snippet}</Msg>
	</p>
	{#if !view || view.status === 'invalid' || view.status === 'failed'}
		<label class="file">
			{t('account.data.file')}
			<input type="file" accept=".zip,application/zip" disabled={busy} onchange={pick} />
		</label>
	{/if}
	{#if progress !== null}
		<div role="progressbar" aria-label={t('account.data.upload')} aria-valuemin="0" aria-valuemax="100" aria-valuenow={progress}>{progress}%</div>
	{/if}
	{#if view?.status === 'validating'}
		<p role="status">{t('account.data.checking')}</p>
	{/if}
	{#if view?.status === 'invalid'}
		<p role="alert">{stageProblem(view)}</p>
		{#if view.report?.blocking.length}<ul>{#each view.report.blocking as b, i (i)}<li>{b}</li>{/each}</ul>{/if}
	{/if}
	{#if view?.status === 'ready' && view.report}
		{@const r = view.report}
		<p>{replaceSentence(r)}</p>
		<p>{restoreSentence(r)}</p>
		{#each r.warnings as w, i (i)}<p role="note">{w}</p>{/each}
		{#if r.pluginsNotInstalled.length}
			<p class="hint">{t('account.data.pluginsNotInstalled', { plugins: r.pluginsNotInstalled.join(', ') })}</p>
		{/if}
		{#if r.reidentifiedEvents}<p class="hint">{t('account.data.reidentified', { count: r.reidentifiedEvents })}</p>{/if}
		{#if needsDropAck(r)}
			<div role="group" aria-label={t('account.data.missingWords')}>
				<p>{t('account.data.missingWordsText')}</p>
				<ul>{#each unresolvedLines(r) as l, i (i)}<li>{l}</li>{/each}</ul>
				{#if r.unresolved.sentences}<p>{t('account.data.missingSentences', { count: r.unresolved.sentences })}</p>{/if}
				<label><input type="checkbox" bind:checked={ackDrop} /> {t('account.data.dropAck')}</label>
			</div>
		{/if}
		<p><button type="button" disabled={busy} onclick={downloadCurrent}>{t('account.data.downloadCurrent')}</button></p>
		<form onsubmit={restore} class="stack">
			<label>{t('account.field.yourPassword')} <input type="password" autocomplete="current-password" bind:value={password} /></label>
			{#if hasTotp}
				<label>{t('account.data.code')} <input autocomplete="one-time-code" bind:value={code} /></label>
			{/if}
			<label>{t('account.data.typeUsername', { username })} <input autocomplete="off" bind:value={typed} /></label>
			<div>
				<button type="submit" disabled={!ok}>{t('account.data.restore')}</button>
				<button type="button" disabled={busy} onclick={cancel}>{t('common.action.cancel')}</button>
			</div>
		</form>
	{/if}
	{#if view?.status === 'running'}
		<p role="status">{t('account.data.restoring')}</p>
	{/if}
	{#if view?.status === 'done' && view.result}
		<p role="status">
			{t('account.data.restored')}
			{#if droppedReviews}{t('account.data.droppedReviews', { count: droppedReviews })}{/if}
			{t('account.data.reloadSoon')}
		</p>
		<p>
			<button type="button" onclick={reload}>{t('account.data.reloadNow')}</button>
			<button type="button" onclick={safety}>{t('account.data.downloadBefore')}</button>
		</p>
	{/if}
	{#if view?.status === 'failed'}
		<p role="alert">{t('account.data.nothingChanged', { problem: stageProblem(view) || t('account.data.failed') })}</p>
	{/if}
	{#if error}<p role="alert">{error}</p>{/if}
	{#if view?.report}<p class="hint">{t('account.data.size', { size: formatBytes(view.report.bytes) })}</p>{/if}
</section>

<style>
	.block { margin-bottom: 2rem; }
	.stack { display: grid; gap: 0.9rem; max-width: 24rem; }
	label { display: grid; gap: 0.25rem; }
	.file { max-width: 24rem; margin: 0.5rem 0; }
	.hint { opacity: 0.8; }
</style>
