<script lang="ts">
	import { onDestroy, tick } from 'svelte';
	import { apiErrorBody } from '$lib/api/client';
	import {
		applyRestore, discardRestore, downloadMyData, restoreStatus, safetyExportTicket, uploadRestore
	} from '$lib/api/backup';
	import { user } from '$lib/auth';
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
			error = errorText(b?.error, b?.message || 'Could not start the download.');
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
			error = errorText(b?.error, b?.message || 'Could not read the state of the restore.');
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
			error = errorText(b?.error, b?.message || 'The upload failed.');
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
			error = errorText(b?.error, b?.message || 'There is no earlier backup to download.');
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
			error = errorText(b?.error, b?.message || 'Could not start the restore.');
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
	<h2 id="account-data-heading" tabindex="-1" bind:this={heading}>Your data</h2>
	<p class="hint">
		A download holds your workspaces, study history, cards, word edits, own sentences and library. It never holds your
		password, sign-in sessions, two-factor secrets or AI keys; after moving to another server you enter AI keys again.
	</p>
	<button type="button" disabled={busy} onclick={download}>Download my data</button>

	<h3>Restore from a backup</h3>
	<p class="hint">Restoring replaces <strong>all</strong> of your data with the backup's, and signs you out on your other devices.</p>
	{#if !view || view.status === 'invalid' || view.status === 'failed'}
		<label class="file">
			Backup file (.zip)
			<input type="file" accept=".zip,application/zip" disabled={busy} onchange={pick} />
		</label>
	{/if}
	{#if progress !== null}
		<div role="progressbar" aria-label="Upload" aria-valuemin="0" aria-valuemax="100" aria-valuenow={progress}>{progress}%</div>
	{/if}
	{#if view?.status === 'validating'}
		<p role="status">Checking the backup…</p>
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
			<p class="hint">Data of plugins that are not installed here is kept but does nothing: {r.pluginsNotInstalled.join(', ')}.</p>
		{/if}
		{#if r.reidentifiedEvents}<p class="hint">{r.reidentifiedEvents} study events got new ids because another account here uses them.</p>{/if}
		{#if needsDropAck(r)}
			<div role="group" aria-label="Words this server does not have">
				<p>This server does not have these words, so what refers to them is dropped:</p>
				<ul>{#each unresolvedLines(r) as l, i (i)}<li>{l}</li>{/each}</ul>
				{#if r.unresolved.sentences}<p>{r.unresolved.sentences} example sentences cannot be matched either.</p>{/if}
				<label><input type="checkbox" bind:checked={ackDrop} /> Drop them and restore the rest</label>
			</div>
		{/if}
		<p><button type="button" disabled={busy} onclick={downloadCurrent}>Download a backup of my current data first</button></p>
		<form onsubmit={restore} class="stack">
			<label>Your password <input type="password" autocomplete="current-password" bind:value={password} /></label>
			{#if hasTotp}
				<label>Authenticator or recovery code <input autocomplete="one-time-code" bind:value={code} /></label>
			{/if}
			<label>Type your username ({username}) to confirm <input autocomplete="off" bind:value={typed} /></label>
			<div>
				<button type="submit" disabled={!ok}>Restore</button>
				<button type="button" disabled={busy} onclick={cancel}>Cancel</button>
			</div>
		</form>
	{/if}
	{#if view?.status === 'running'}
		<p role="status">Restoring your data… this can take a minute for a large history.</p>
	{/if}
	{#if view?.status === 'done' && view.result}
		<p role="status">
			Your data was restored. You were signed out on your other devices.
			{#if droppedReviews}{droppedReviews} reviews waiting on this device for the old workspaces were discarded.{/if}
			The app reloads in a moment.
		</p>
		<p>
			<button type="button" onclick={reload}>Reload now</button>
			<button type="button" onclick={safety}>Download the data I had before</button>
		</p>
	{/if}
	{#if view?.status === 'failed'}
		<p role="alert">{stageProblem(view) || 'The restore failed.'} Nothing was changed.</p>
	{/if}
	{#if error}<p role="alert">{error}</p>{/if}
	{#if view?.report}<p class="hint">Size of the backup: {formatBytes(view.report.bytes)}.</p>{/if}
</section>

<style>
	.block { margin-bottom: 2rem; }
	.stack { display: grid; gap: 0.9rem; max-width: 24rem; }
	label { display: grid; gap: 0.25rem; }
	.file { max-width: 24rem; margin: 0.5rem 0; }
	.hint { opacity: 0.8; }
</style>
