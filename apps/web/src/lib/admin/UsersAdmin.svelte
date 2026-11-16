<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { apiErrorBody } from '$lib/api/client';
	import { getAuthOptions, type AuthOptions } from '$lib/api/account';
	import {
		createUser,
		issueResetLink,
		revokeResetLink,
		listUsers,
		patchUser,
		revokeUserSessions,
		type AdminUserDto
	} from '$lib/api/adminUsers';
	import { passwordHint } from '$lib/account/passwordRules';
	import { user as me } from '$lib/auth';
	import DeleteUserDialog from './DeleteUserDialog.svelte';
	import ResetMfaDialog from './ResetMfaDialog.svelte';
	import { resetNotice, type MfaFactors } from './mfaResetView';
	import { NEEDS_PASSWORD, generateTempPassword, userRows, type UserActionId } from './usersView';

	let users = $state<AdminUserDto[]>([]);
	let loaded = $state(false);
	let error = $state('');
	let notice = $state('');
	let busy = $state(false);
	let emailPolicy = $state<AuthOptions['emailPolicy']>('off');

	let username = $state('');
	let password = $state('');
	let email = $state('');
	let makeAdmin = $state(false);
	let createNote = $state('');

	// The reset link is shown once, in full; closing it forgets it.
	let resetLink = $state<{ username: string; url: string; expiresAt: string } | null>(null);
	let copied = $state(false);
	let deleting = $state<{ id: number; username: string } | null>(null);
	let resettingMfa = $state<{ id: number; username: string; mfa: MfaFactors } | null>(null);
	// An action waiting for the acting administrator's own password.
	let askPassword = $state<{ id: number; username: string; action: UserActionId } | null>(null);
	let ownPassword = $state('');
	let heading = $state<HTMLHeadingElement | null>(null);

	const rows = $derived(userRows(users, $me?.id ?? 0, new Date()));

	function message(err: unknown, fallback: string): string {
		return apiErrorBody(err)?.message || (err instanceof Error ? err.message : '') || fallback;
	}

	async function load(): Promise<void> {
		try {
			users = await listUsers();
			error = '';
		} catch (err) {
			error = message(err, 'Could not load the users.');
		} finally {
			loaded = true;
		}
	}

	onMount(() => {
		void load();
		getAuthOptions().then(
			(o) => (emailPolicy = o.emailPolicy),
			() => undefined
		);
	});

	async function create(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (busy) return;
		busy = true;
		error = createNote = '';
		try {
			const created = await createUser({
				username: username.trim(),
				password,
				...(emailPolicy !== 'off' && email.trim() ? { email: email.trim() } : {}),
				admin: makeAdmin
			});
			createNote = `${created.username} was created. They must choose a new password when they first sign in.`;
			username = password = email = '';
			makeAdmin = false;
			await load();
		} catch (err) {
			error = message(err, 'Could not create the user.');
		} finally {
			busy = false;
		}
	}

	async function run(row: { id: number; username: string }, id: UserActionId, password = ''): Promise<void> {
		if (busy) return;
		if (id === 'delete') {
			deleting = { id: row.id, username: row.username };
			return;
		}
		if (id === 'resetMfa') {
			const mfa = users.find((u) => u.id === row.id)?.mfa ?? { totp: false, email: false };
			error = notice = '';
			resettingMfa = { id: row.id, username: row.username, mfa };
			return;
		}
		if (NEEDS_PASSWORD.has(id) && !password) {
			askPassword = { id: row.id, username: row.username, action: id };
			ownPassword = '';
			return;
		}
		askPassword = null;
		busy = true;
		error = notice = '';
		try {
			switch (id) {
				case 'makeAdmin':
					await patchUser(row.id, { admin: true, currentPassword: password });
					break;
				case 'removeAdmin':
					await patchUser(row.id, { admin: false });
					break;
				case 'disable':
					await patchUser(row.id, { disabled: true });
					break;
				case 'enable':
					await patchUser(row.id, { disabled: false });
					break;
				case 'requirePasswordChange':
					await patchUser(row.id, { mustChangePassword: true });
					notice = `${row.username} signed out everywhere and must choose a new password at the next sign-in.`;
					break;
				case 'signOutEverywhere': {
					const out = await revokeUserSessions(row.id);
					notice = `${row.username} was signed out of ${out.revoked} session${out.revoked === 1 ? '' : 's'}.`;
					break;
				}
				case 'revokeResetLink':
					await revokeResetLink(row.id);
					notice = `Any pending reset link of ${row.username} was revoked.`;
					break;
				case 'resetLink': {
					const out = await issueResetLink(row.id, password);
					resetLink = { username: row.username, url: location.origin + out.path, expiresAt: out.expiresAt };
					copied = false;
					break;
				}
			}
			await load();
		} catch (err) {
			error = message(err, 'That did not work.');
		} finally {
			busy = false;
		}
	}

	async function copy(): Promise<void> {
		if (!resetLink) return;
		try {
			await navigator.clipboard.writeText(resetLink.url);
			copied = true;
		} catch {
			error = 'Could not copy. Select the link and copy it by hand.';
		}
	}

	async function closeResetMfa(reset: boolean): Promise<void> {
		const who = resettingMfa?.username ?? '';
		resettingMfa = null;
		if (reset) {
			notice = resetNotice(who);
			await load();
		}
		await tick();
		heading?.focus();
	}

	async function closeDelete(deleted: boolean): Promise<void> {
		deleting = null;
		if (deleted) await load();
		await tick();
		heading?.focus();
	}
</script>

<section aria-labelledby="admin-users-heading">
	<h2 id="admin-users-heading" tabindex="-1" bind:this={heading}>Users</h2>
	{#if error}<p class="error" role="alert">{error}</p>{/if}
	<p class="ok" role="status">{notice}</p>

	{#if askPassword}
		<form
			class="link"
			aria-label="Confirm with your password"
			onsubmit={(event) => {
				event.preventDefault();
				const a = askPassword;
				if (a) void run({ id: a.id, username: a.username }, a.action, ownPassword);
			}}
		>
			<label>
				Your own password, to confirm this for {askPassword.username}
				<input type="password" autocomplete="current-password" bind:value={ownPassword} required />
			</label>
			<button type="submit" disabled={busy || ownPassword === ''}>Confirm</button>
			<button type="button" onclick={() => (askPassword = null)}>Cancel</button>
		</form>
	{/if}

	{#if resetLink}
		<div class="link" role="group" aria-label="Reset link">
			<p>
				Reset link for <strong>{resetLink.username}</strong>. This link is shown once; it works until
				{new Date(resetLink.expiresAt).toLocaleString()}.
			</p>
			<input readonly value={resetLink.url} aria-label="Reset link address" onfocus={(e) => e.currentTarget.select()} />
			<button type="button" onclick={copy}>{copied ? 'Copied' : 'Copy'}</button>
			<button type="button" onclick={() => (resetLink = null)}>Close</button>
		</div>
	{/if}

	{#if loaded}
		<table aria-label="Users">
			<thead>
				<tr>
					<th scope="col">Username</th>
					{#if emailPolicy !== 'off'}<th scope="col">Email</th>{/if}
					<th scope="col">Role</th>
					<th scope="col">Status</th>
					<th scope="col">Last seen</th>
					<th scope="col">Actions</th>
				</tr>
			</thead>
			<tbody>
				{#each rows as row (row.id)}
					<tr>
						<th scope="row">{row.username}{#if row.self} <span class="badge">You</span>{/if}</th>
						{#if emailPolicy !== 'off'}<td>{row.email}</td>{/if}
						<td>{row.role}</td>
						<td>{#each row.status as s (s)}<span class="badge">{s}</span>{/each}</td>
						<td>{row.lastSeen}</td>
						<td>
							<details>
								<summary>Actions for {row.username}</summary>
								<ul class="actions">
									{#each row.actions as action (action.id)}
										<li>
											<button
												type="button"
												disabled={busy || action.disabled}
												aria-describedby={action.reason ? `why-${row.id}-${action.id}` : undefined}
												onclick={() => run(row, action.id)}>{action.label}</button
											>
											{#if action.reason}<span class="hint" id="why-{row.id}-{action.id}">{action.reason}</span>{/if}
										</li>
									{/each}
								</ul>
							</details>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}

	<h3>Create user</h3>
	<form onsubmit={create} class="stack">
		<label>
			Username
			<input bind:value={username} autocomplete="off" required />
		</label>
		<label>
			Temporary password
			<span class="row">
				<input bind:value={password} autocomplete="off" required aria-describedby="admin-user-pw-rules" />
				<button type="button" onclick={() => (password = generateTempPassword())}>Generate</button>
			</span>
		</label>
		<p class="hint" id="admin-user-pw-rules">{passwordHint()}</p>
		{#if emailPolicy !== 'off'}
			<label>
				{emailPolicy === 'required' ? 'Email' : 'Email (optional)'}
				<input type="email" bind:value={email} required={emailPolicy === 'required'} />
			</label>
		{/if}
		<label class="check"><input type="checkbox" bind:checked={makeAdmin} /> Administrator</label>
		<p class="ok" role="status">{createNote}</p>
		<button type="submit" disabled={busy}>Create user</button>
	</form>
</section>

{#if deleting}
	<DeleteUserDialog id={deleting.id} username={deleting.username} onclose={closeDelete} />
{/if}

{#if resettingMfa}
	<ResetMfaDialog
		id={resettingMfa.id}
		username={resettingMfa.username}
		mfa={resettingMfa.mfa}
		onclose={closeResetMfa}
		ongone={() => void load()}
	/>
{/if}

<style>
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
		vertical-align: top;
	}
	.badge {
		margin-right: 0.35rem;
		padding: 0.1rem 0.45rem;
		border: 1px solid currentColor;
		border-radius: 0.8rem;
		font-size: 0.8em;
	}
	.actions {
		list-style: none;
		margin: 0.4rem 0 0;
		padding: 0;
		display: grid;
		gap: 0.3rem;
	}
	.stack {
		display: grid;
		gap: 0.8rem;
		max-width: 26rem;
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
	.row {
		display: flex;
		gap: 0.5rem;
	}
	.row input {
		flex: 1;
	}
	input:not([type='checkbox']) {
		font: inherit;
		padding: 0.45rem 0.6rem;
	}
	.link {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
		padding: 0.8rem;
		border: 1px solid color-mix(in srgb, currentColor 35%, transparent);
		border-radius: 0.5rem;
	}
	.link p {
		flex-basis: 100%;
		margin: 0;
	}
	.link input {
		flex: 1;
		min-width: 12rem;
	}
	.hint {
		opacity: 0.75;
		font-size: 0.9em;
		margin: 0;
	}
	.error {
		color: #c62828;
		font-weight: 600;
	}
	.ok {
		min-height: 1.2em;
		margin: 0.4rem 0;
	}
	button:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}
</style>
