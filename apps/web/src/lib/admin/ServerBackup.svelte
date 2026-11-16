<script lang="ts">
	import { apiErrorBody } from '$lib/api/client';
	import { createServerBackup } from '$lib/api/backup';
	import { user } from '$lib/auth';
	import { PARTS, RESTORE_STEPS, SECURITY_NOTE, backupError, canCreate, includeBody } from './serverBackupView';
	import { tick } from 'svelte';
	import ReauthFields from './ReauthFields.svelte';
	import { reauthBody, reauthFocus, reauthNeedsCode } from './reauth';

	let { assign = (u: string) => location.assign(u) }: { assign?: (url: string) => void } = $props();

	let selected = $state(new Set(PARTS.map((p) => p.id)));
	let password = $state('');
	let code = $state('');
	let sawCodeInvalid = $state(false);
	const needsCode = $derived(reauthNeedsCode($user?.mfa?.totp, sawCodeInvalid));
	let fields = $state<ReturnType<typeof ReauthFields> | null>(null);
	let busy = $state(false);
	let error = $state('');
	let started = $state(false);

	function toggle(id: string, on: boolean): void {
		const next = new Set(selected);
		if (on) next.add(id);
		else next.delete(id);
		selected = next;
	}

	async function create(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (!canCreate(selected, password, busy, needsCode, code)) return;
		busy = true;
		error = '';
		started = false;
		try {
			const r = reauthBody(password, needsCode, code);
			const out = await createServerBackup({ currentPassword: r.currentPassword, code: r.code, include: includeBody(selected) });
			password = '';
			code = '';
			started = true;
			assign(out.url);
		} catch (err) {
			const b = apiErrorBody(err);
			error = backupError(b?.error, b?.message || 'Could not create the backup.');
			if (b?.error === 'code_invalid') sawCodeInvalid = true;
			const f = reauthFocus(b?.error);
			if (f.clear === 'code') code = '';
			if (f.clear === 'password') password = '';
			busy = false;
			if (f.clear) {
				await tick();
				fields?.focusField(f.focus);
			}
		} finally {
			busy = false;
		}
	}
</script>

<section aria-labelledby="server-backup-heading">
	<h2 id="server-backup-heading">Server backup</h2>
	<p>{SECURITY_NOTE}</p>
	<form onsubmit={create} class="stack">
		<fieldset>
			<legend>Include</legend>
			{#each PARTS as p (p.id)}
				<label>
					<input type="checkbox" checked={selected.has(p.id)} onchange={(e) => toggle(p.id, e.currentTarget.checked)} />
					{p.label} <span class="hint">{p.hint}</span>
				</label>
			{/each}
		</fieldset>
		<ReauthFields bind:this={fields} bind:password bind:code {needsCode} passwordLabel="Your password" />
		<button type="submit" disabled={!canCreate(selected, password, busy, needsCode, code)}>Create server backup</button>
	</form>
	{#if started}<p role="status">The download starts now.</p>{/if}
	{#if error}<p role="alert">{error}</p>{/if}
	<h3>Restoring a server backup</h3>
	<p>Restoring is done offline, not from this page:</p>
	<ol>{#each RESTORE_STEPS as s (s)}<li>{s}</li>{/each}</ol>
	<p class="hint">
		For a schedule use <code>qinqin backup --out &lt;file&gt;</code> from cron. Details in the README, section Backup.
	</p>
</section>

<style>
	.stack { display: grid; gap: 0.9rem; max-width: 28rem; }
	label { display: grid; gap: 0.15rem; }
	.hint { opacity: 0.75; font-size: 0.9em; }
</style>
