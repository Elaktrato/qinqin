<script lang="ts">
	import { onMount } from 'svelte';
	import { apiErrorBody } from '$lib/api/client';
	import {
		changePassword,
		getAuthOptions,
		listSessions,
		putEmail,
		revokeSession,
		revokeSessions,
		type AuthOptions
	} from '$lib/api/account';
	import EmailBanner from '$lib/account/EmailBanner.svelte';
	import { emailSection } from '$lib/account/emailView';
	import DeleteAccountDialog from './DeleteAccountDialog.svelte';
	import TwoFactorManage from '$lib/account/TwoFactorManage.svelte';
	import EmailVerify from '$lib/account/EmailVerify.svelte';
	import { mailAvailable } from '$lib/account/mfaView';
	import { confirmProblem, passwordHint, passwordProblem } from '$lib/account/passwordRules';
	import {
		LOGOUT_EVERYWHERE_CONFIRM,
		sessionRows,
		type SessionDto
	} from '$lib/account/sessionsView';
	import { loadMe, logout, user } from '$lib/auth';

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

	// Profile: the email field follows the instance policy.
	let emailPolicy = $state<AuthOptions['emailPolicy'] | null>(null);
	let emailDraft = $state('');
	let emailPassword = $state('');
	let emailError = $state('');
	let emailDone = $state('');
	let emailBusy = $state(false);
	let optionsAll = $state<AuthOptions | null>(null);
	let verifying = $state(false);
	let deleting = $state(false);
	const emailView = $derived(emailSection(emailPolicy, $user?.email ?? null));

	async function saveEmail(next: string | null): Promise<void> {
		if (emailBusy) return;
		emailError = emailDone = '';
		emailBusy = true;
		try {
			const res = await putEmail(next, emailPassword);
			verifying = res.verification === 'sent';
			emailDone = next === null ? 'Email address removed.' : verifying ? 'Email address saved. Enter the code we sent to confirm it.' : 'Email address saved.';
			emailPassword = emailDraft = '';
			await loadMe();
		} catch (err) {
			const body = apiErrorBody(err);
			emailError =
				body?.error === 'wrong_password' ? 'The password is wrong.' : message(err, 'Could not save the email address.');
		} finally {
			emailBusy = false;
		}
	}

	onMount(() => {
		void loadSessions();
		getAuthOptions().then(
			(o) => ((emailPolicy = o.emailPolicy), (optionsAll = o)),
			() => undefined
		);
	});

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

<section aria-labelledby="account-profile-heading" class="block">
	<h2 id="account-profile-heading">Profile</h2>
	<p>Username: <strong>{$user?.username}</strong></p>
	<EmailBanner link={false} />
	{#if emailView.visible}
		<form
			onsubmit={(event) => {
				event.preventDefault();
				void saveEmail(emailDraft.trim() === '' ? null : emailDraft.trim());
			}}
			class="stack"
		>
			<p class="hint">
				{#if $user?.email}Current address: {$user.email}{:else}No address saved.{/if}
			</p>
			<label>
				{emailView.label}
				<input type="email" autocomplete="email" bind:value={emailDraft} />
			</label>
			<label>
				Your password
				<input type="password" autocomplete="current-password" bind:value={emailPassword} required />
			</label>
			{#if emailError}<p class="error" role="alert">{emailError}</p>{/if}
			<p class="ok" role="status">{emailDone}</p>
			<div class="actions">
				<button type="submit" disabled={emailBusy || emailDraft.trim() === ''}>Save email</button>
				{#if emailView.canClear}
					<button type="button" disabled={emailBusy || emailPassword === ''} onclick={() => saveEmail(null)}
						>Remove email</button
					>
				{/if}
			</div>
		</form>
		{#if $user?.email && !$user.emailVerified && mailAvailable(optionsAll)}
			{#if verifying}
				<EmailVerify address={$user.email} onverified={async () => { verifying = false; await loadMe(); }} />
			{:else}
				<p class="hint">This address is not confirmed yet.
					<button type="button" class="link" onclick={() => (verifying = true)}>Confirm it</button></p>
			{/if}
		{/if}
	{/if}
</section>

<TwoFactorManage options={optionsAll} />

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

<section aria-labelledby="account-delete-heading" class="block">
	<h2 id="account-delete-heading">Delete account</h2>
	<p class="hint">Permanently deletes your account and everything in it.</p>
	<button type="button" onclick={() => (deleting = true)}>Delete my account…</button>
</section>

{#if deleting && $user}
	<DeleteAccountDialog
		username={$user.username}
		onclose={() => (deleting = false)}
		ondone={() => {
			deleting = false;
			logout();
		}}
	/>
{/if}

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
