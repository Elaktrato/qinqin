<script lang="ts">
	import { onMount } from 'svelte';
	import { apiErrorBody } from '$lib/api/client';
	import { changePassword, listSessions, revokeSession, revokeSessions } from '$lib/api/account';
	import { confirmProblem, passwordHint, passwordProblem } from '$lib/account/passwordRules';
	import {
		LOGOUT_EVERYWHERE_CONFIRM,
		sessionRows,
		type SessionDto
	} from '$lib/account/sessionsView';
	import { logout, user } from '$lib/auth';

	let current = $state('');
	let next = $state('');
	let confirm = $state('');
	let signOutOthers = $state(true);
	let pwError = $state('');
	let pwDone = $state('');
	let pwBusy = $state(false);

	let sessions = $state<SessionDto[]>([]);
	let sessionsError = $state('');
	let sessionsLoaded = $state(false);
	let confirmingAll = $state(false);
	let busy = $state(false);

	const rows = $derived(sessionRows(sessions, new Date()));
	const hasOthers = $derived(rows.some((r) => r.canRevoke));

	function message(err: unknown, fallback: string): string {
		return apiErrorBody(err)?.message || (err instanceof Error ? err.message : '') || fallback;
	}

	async function loadSessions(): Promise<void> {
		try {
			sessions = await listSessions();
			sessionsError = '';
		} catch (err) {
			sessionsError = message(err, 'Could not load your sessions.');
		} finally {
			sessionsLoaded = true;
		}
	}

	onMount(() => void loadSessions());

	async function submitPassword(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (pwBusy) return;
		pwError = '';
		pwDone = '';
		const problem =
			passwordProblem($user?.username ?? '', next) ?? confirmProblem(next, confirm);
		if (problem) {
			pwError = problem;
			return;
		}
		pwBusy = true;
		try {
			await changePassword({ currentPassword: current, newPassword: next, signOutOthers });
			pwDone = signOutOthers
				? 'Password changed. Your other sessions were signed out.'
				: 'Password changed.';
			current = next = confirm = '';
			await loadSessions();
		} catch (err) {
			// A wrong current password is a 403, so the session stays signed in.
			const body = apiErrorBody(err);
			pwError =
				body?.error === 'wrong_password'
					? 'The current password is wrong.'
					: message(err, 'Could not change the password.');
		} finally {
			pwBusy = false;
		}
	}

	async function revokeOne(id: number): Promise<void> {
		if (busy) return;
		busy = true;
		try {
			await revokeSession(id);
			sessions = sessions.filter((s) => s.id !== id);
			sessionsError = '';
		} catch (err) {
			sessionsError = message(err, 'Could not revoke that session.');
		} finally {
			busy = false;
		}
	}

	async function revokeOthers(): Promise<void> {
		if (busy) return;
		busy = true;
		try {
			await revokeSessions('others');
			await loadSessions();
		} catch (err) {
			sessionsError = message(err, 'Could not log the other devices out.');
		} finally {
			busy = false;
		}
	}

	async function revokeAll(): Promise<void> {
		if (busy) return;
		busy = true;
		try {
			await revokeSessions('all');
			// Every session is gone, this one too: clear the local state.
			logout();
		} catch (err) {
			sessionsError = message(err, 'Could not log out everywhere.');
			confirmingAll = false;
		} finally {
			busy = false;
		}
	}
</script>

<section aria-labelledby="account-password-heading" class="block">
	<h2 id="account-password-heading">Password</h2>
	<form onsubmit={submitPassword} class="stack">
		<label>
			Current password
			<input type="password" autocomplete="current-password" bind:value={current} required />
		</label>
		<label>
			New password
			<input
				type="password"
				autocomplete="new-password"
				aria-describedby="account-password-rules"
				bind:value={next}
				required
			/>
		</label>
		<p class="hint" id="account-password-rules">{passwordHint()}</p>
		<label>
			Repeat the new password
			<input type="password" autocomplete="new-password" bind:value={confirm} required />
		</label>
		<label class="check">
			<input type="checkbox" bind:checked={signOutOthers} />
			Sign out my other sessions
		</label>
		{#if pwError}<p class="error" role="alert">{pwError}</p>{/if}
		<p class="ok" role="status">{pwDone}</p>
		<button type="submit" disabled={pwBusy}>{pwBusy ? 'Changing…' : 'Change password'}</button>
	</form>
</section>

<section aria-labelledby="account-sessions-heading" class="block">
	<h2 id="account-sessions-heading">Sessions</h2>
	<p class="hint">Devices that are signed in to your account.</p>
	{#if sessionsError}<p class="error" role="alert">{sessionsError}</p>{/if}
	{#if sessionsLoaded && rows.length > 0}
		<table aria-label="Signed-in devices">
			<thead>
				<tr>
					<th scope="col">Device</th>
					<th scope="col">Signed in</th>
					<th scope="col">Last active</th>
					<th scope="col"><span class="visually-hidden">Actions</span></th>
				</tr>
			</thead>
			<tbody>
				{#each rows as row (row.id)}
					<tr>
						<th scope="row">
							{row.deviceLabel}
							{#if row.badge}<span class="badge">{row.badge}</span>{/if}
						</th>
						<td>{row.signedIn}</td>
						<td>{row.lastActive}</td>
						<td>
							{#if row.canRevoke}
								<button
									type="button"
									disabled={busy}
									aria-label={`Revoke ${row.deviceLabel}`}
									onclick={() => revokeOne(row.id)}>Revoke</button
								>
							{/if}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
	<div class="actions">
		<button type="button" disabled={busy || !hasOthers} onclick={revokeOthers}
			>Log out everywhere else</button
		>
		<button type="button" disabled={busy} onclick={() => (confirmingAll = true)}
			>Log out everywhere</button
		>
	</div>
	{#if confirmingAll}
		<div class="confirm" role="group" aria-label="Confirm log out everywhere">
			<p>{LOGOUT_EVERYWHERE_CONFIRM}</p>
			<button type="button" disabled={busy} onclick={revokeAll}>Yes, log out everywhere</button>
			<button type="button" disabled={busy} onclick={() => (confirmingAll = false)}>Cancel</button>
		</div>
	{/if}
</section>

<style>
	.block {
		margin-bottom: 2rem;
	}
	.stack {
		display: grid;
		gap: 0.9rem;
		max-width: 24rem;
	}
	label {
		display: grid;
		gap: 0.3rem;
		font-weight: 600;
	}
	label.check {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		font-weight: 400;
	}
	input:not([type='checkbox']) {
		font: inherit;
		padding: 0.5rem 0.65rem;
		border: 1px solid color-mix(in srgb, currentColor 35%, transparent);
		border-radius: 0.4rem;
		background: transparent;
		color: inherit;
	}
	.hint {
		margin: 0;
		opacity: 0.75;
	}
	.error {
		margin: 0;
		color: #c62828;
		font-weight: 600;
	}
	.ok {
		margin: 0;
		min-height: 1.2em;
	}
	table {
		border-collapse: collapse;
		width: 100%;
		margin: 0.75rem 0;
	}
	th,
	td {
		text-align: left;
		padding: 0.45rem 0.6rem;
		border-bottom: 1px solid color-mix(in srgb, currentColor 18%, transparent);
	}
	tbody th {
		font-weight: 600;
	}
	.badge {
		margin-left: 0.5rem;
		padding: 0.1rem 0.45rem;
		border: 1px solid currentColor;
		border-radius: 0.8rem;
		font-size: 0.8em;
		font-weight: 600;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
	}
	button {
		font: inherit;
		padding: 0.45rem 0.9rem;
		border: 1px solid color-mix(in srgb, currentColor 40%, transparent);
		border-radius: 0.4rem;
		background: transparent;
		color: inherit;
		cursor: pointer;
	}
	button[type='submit'] {
		background: #0b6bcb;
		border-color: #0b6bcb;
		color: #fff;
		font-weight: 600;
		justify-self: start;
	}
	button:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}
	.confirm {
		margin-top: 0.8rem;
		padding: 0.8rem;
		border: 1px solid color-mix(in srgb, currentColor 35%, transparent);
		border-radius: 0.5rem;
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
		align-items: center;
	}
	.confirm p {
		flex-basis: 100%;
		margin: 0;
	}
</style>
