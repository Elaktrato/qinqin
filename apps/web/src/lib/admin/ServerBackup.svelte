<script lang="ts">
	import { apiErrorBody } from '$lib/api/client';
	import { createServerBackup } from '$lib/api/backup';
	import { PARTS, RESTORE_STEPS, SECURITY_NOTE, backupError, canCreate, includeBody } from './serverBackupView';

	let { assign = (u: string) => location.assign(u) }: { assign?: (url: string) => void } = $props();

	let selected = $state(new Set(PARTS.map((p) => p.id)));
	let password = $state('');
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
		if (!canCreate(selected, password, busy)) return;
		busy = true;
		error = '';
		started = false;
		try {
			const out = await createServerBackup({ currentPassword: password, include: includeBody(selected) });
			password = '';
			started = true;
			assign(out.url);
		} catch (err) {
			const b = apiErrorBody(err);
			error = backupError(b?.error, b?.message || 'Could not create the backup.');
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
		<label>Your password <input type="password" autocomplete="current-password" bind:value={password} /></label>
		<button type="submit" disabled={!canCreate(selected, password, busy)}>Create server backup</button>
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
