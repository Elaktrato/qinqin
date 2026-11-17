<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { apiErrorBody } from '$lib/api/client';
	import { errorText } from '$lib/api/apiErrors';
	import { t } from '$lib/i18n';
	import Msg from '$lib/i18n/Msg.svelte';
	import { formatDateTime } from '$lib/i18n/format';
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
	import ReauthFields from './ReauthFields.svelte';
	import { reauthBody, reauthError, reauthFocus, reauthNeedsCode, reauthReady, type Reauth } from './reauth';
	import { actionNeedsReauth, generateTempPassword, userRows, type UserActionId } from './usersView';

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
	let ownCode = $state('');
	// Creating an administrator re-authenticates too.
	let createPassword = $state('');
	let createCode = $state('');
	// The server asked for a code although "me" says no authenticator (a stale copy).
	let sawCodeInvalid = $state(false);
	const needsCode = $derived(reauthNeedsCode($me?.mfa?.totp, sawCodeInvalid));
	let askFields = $state<ReturnType<typeof ReauthFields> | null>(null);
	let createFields = $state<ReturnType<typeof ReauthFields> | null>(null);
	let heading = $state<HTMLHeadingElement | null>(null);

	const rows = $derived(userRows(users, $me?.id ?? 0, new Date()));

	const message = errorText;

	/** A re-authentication refusal: fixed sentence, clear and focus the field to fix. True if it was one. */
	async function reauthRefused(err: unknown, which: 'ask' | 'create'): Promise<boolean> {
		const kind = apiErrorBody(err)?.error;
		if (!kind || !['wrong_password', 'password_required', 'code_invalid', 'rate_limited', 'busy'].includes(kind)) return false;
		error = reauthError(kind);
		if (kind === 'code_invalid') sawCodeInvalid = true;
		const f = reauthFocus(kind);
		if (which === 'ask') {
			if (f.clear === 'code') ownCode = '';
			if (f.clear === 'password') ownPassword = '';
		} else {
			if (f.clear === 'code') createCode = '';
			if (f.clear === 'password') createPassword = '';
		}
		await tick();
		(which === 'ask' ? askFields : createFields)?.focusField(f.focus);
		return true;
	}

	async function load(): Promise<void> {
		try {
			users = await listUsers();
			error = '';
		} catch (err) {
			error = message(err, t('admin.users.error.load'));
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
		if (makeAdmin && !reauthReady(createPassword, needsCode, createCode)) return;
		busy = true;
		error = createNote = '';
		let refused: unknown = null;
		try {
			const created = await createUser({
				username: username.trim(),
				password,
				...(emailPolicy !== 'off' && email.trim() ? { email: email.trim() } : {}),
				admin: makeAdmin,
				...(makeAdmin ? reauthBody(createPassword, needsCode, createCode) : {})
			});
			createNote = t('admin.users.created', { name: created.username });
			username = password = email = createPassword = createCode = '';
			makeAdmin = false;
			await load();
		} catch (err) {
			refused = err;
			error = message(err, t('admin.users.error.create'));
		} finally {
			busy = false;
		}
		if (refused) await reauthRefused(refused, 'create');
	}

	async function run(row: { id: number; username: string }, id: UserActionId, reauth?: Reauth): Promise<void> {
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
		const target = users.find((u) => u.id === row.id);
		if (actionNeedsReauth(id, { admin: !!target?.admin, self: row.id === $me?.id }) && !reauth) {
			askPassword = { id: row.id, username: row.username, action: id };
			ownPassword = ownCode = '';
			error = '';
			await tick();
			askFields?.focusField('password');
			return;
		}
		busy = true;
		error = notice = '';
		let refused: unknown = null;
		try {
			switch (id) {
				case 'makeAdmin':
					await patchUser(row.id, { admin: true, ...reauth });
					break;
				case 'removeAdmin':
					await patchUser(row.id, { admin: false, ...reauth });
					break;
				case 'disable':
					await patchUser(row.id, { disabled: true, ...reauth });
					break;
				case 'enable':
					await patchUser(row.id, { disabled: false });
					break;
				case 'requirePasswordChange':
					await patchUser(row.id, { mustChangePassword: true });
					notice = t('admin.users.notice.passwordChange', { name: row.username });
					break;
				case 'signOutEverywhere': {
					const out = await revokeUserSessions(row.id);
					notice = t('admin.users.notice.signedOut', { name: row.username, count: out.revoked });
					break;
				}
				case 'revokeResetLink':
					await revokeResetLink(row.id);
					notice = t('admin.users.notice.resetLinkRevoked', { name: row.username });
					break;
				case 'resetLink': {
					const out = await issueResetLink(row.id, reauth ?? { currentPassword: '' });
					resetLink = { username: row.username, url: location.origin + out.path, expiresAt: out.expiresAt };
					copied = false;
					break;
				}
			}
			if (reauth) {
				askPassword = null;
				ownPassword = ownCode = '';
			}
			await load();
		} catch (err) {
			refused = err;
			error = message(err, t('admin.users.error.action'));
		} finally {
			busy = false;
		}
		// a refused re-authentication keeps the form open on the field to fix
		if (refused && reauth && !(await reauthRefused(refused, 'ask'))) askPassword = null;
	}

	async function copy(): Promise<void> {
		if (!resetLink) return;
		try {
			await navigator.clipboard.writeText(resetLink.url);
			copied = true;
		} catch {
			error = t('admin.users.error.copy');
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
	<h2 id="admin-users-heading" tabindex="-1" bind:this={heading}>{t('admin.users.title')}</h2>
	{#if error}<p class="error" role="alert">{error}</p>{/if}
	<p class="ok" role="status">{notice}</p>

	{#if askPassword}
		<form
			class="link"
			aria-label={t('admin.users.confirm.label')}
			onsubmit={(event) => {
				event.preventDefault();
				const a = askPassword;
				if (a && reauthReady(ownPassword, needsCode, ownCode))
					void run({ id: a.id, username: a.username }, a.action, reauthBody(ownPassword, needsCode, ownCode));
			}}
		>
			<ReauthFields
				bind:this={askFields}
				bind:password={ownPassword}
				bind:code={ownCode}
				{needsCode}
				passwordLabel={t('admin.users.confirm.ownPassword', { name: askPassword.username })}
			/>
			<button type="submit" disabled={busy || !reauthReady(ownPassword, needsCode, ownCode)}>{t('admin.users.confirm.submit')}</button>
			<button type="button" onclick={() => (askPassword = null)}>{t('common.action.cancel')}</button>
		</form>
	{/if}

	{#if resetLink}
		<div class="link" role="group" aria-label={t('admin.users.resetLink.label')}>
			<p>
				<Msg
					key="admin.users.resetLink.text"
					args={{ name: resetLink.username, until: formatDateTime(resetLink.expiresAt) }}
					>{#snippet strong(text: string)}<strong>{text}</strong>{/snippet}</Msg
				>
			</p>
			<input readonly value={resetLink.url} aria-label={t('admin.users.resetLink.address')} onfocus={(e) => e.currentTarget.select()} />
			<button type="button" onclick={copy}>{copied ? t('common.action.copied') : t('common.action.copy')}</button>
			<button type="button" onclick={() => (resetLink = null)}>{t('admin.users.resetLink.close')}</button>
		</div>
	{/if}

	{#if loaded}
		<table aria-label={t('admin.users.title')}>
			<thead>
				<tr>
					<th scope="col">{t('admin.users.col.username')}</th>
					{#if emailPolicy !== 'off'}<th scope="col">{t('admin.users.col.email')}</th>{/if}
					<th scope="col">{t('admin.users.col.role')}</th>
					<th scope="col">{t('admin.users.col.status')}</th>
					<th scope="col">{t('admin.users.col.lastSeen')}</th>
					<th scope="col">{t('admin.users.col.actions')}</th>
				</tr>
			</thead>
			<tbody>
				{#each rows as row (row.id)}
					<tr>
						<th scope="row">{row.username}{#if row.self} <span class="badge">{t('admin.users.you')}</span>{/if}</th>
						{#if emailPolicy !== 'off'}<td>{row.email}</td>{/if}
						<td>{row.role}</td>
						<td>{#each row.status as s (s)}<span class="badge">{s}</span>{/each}</td>
						<td>{row.lastSeen}</td>
						<td>
							<details>
								<summary>{t('admin.users.actionsFor', { name: row.username })}</summary>
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

	<h3>{t('admin.users.create.title')}</h3>
	<form onsubmit={create} class="stack">
		<label>
			{t('admin.users.create.username')}
			<input bind:value={username} autocomplete="off" required />
		</label>
		<label>
			{t('admin.users.create.tempPassword')}
			<span class="row">
				<input bind:value={password} autocomplete="off" required aria-describedby="admin-user-pw-rules" />
				<button type="button" onclick={() => (password = generateTempPassword())}>{t('admin.users.create.generate')}</button>
			</span>
		</label>
		<p class="hint" id="admin-user-pw-rules">{passwordHint()}</p>
		{#if emailPolicy !== 'off'}
			<label>
				{emailPolicy === 'required' ? t('admin.users.create.email') : t('admin.users.create.emailOptional')}
				<input type="email" bind:value={email} required={emailPolicy === 'required'} />
			</label>
		{/if}
		<label class="check"><input type="checkbox" bind:checked={makeAdmin} /> {t('admin.users.create.admin')}</label>
		{#if makeAdmin}
			<div class="reauth">
				<ReauthFields
					bind:this={createFields}
					bind:password={createPassword}
					bind:code={createCode}
					{needsCode}
					passwordLabel={t('admin.users.create.ownPassword')}
				/>
			</div>
		{/if}
		<p class="ok" role="status">{createNote}</p>
		<button type="submit" disabled={busy || (makeAdmin && !reauthReady(createPassword, needsCode, createCode))}
			>{t('admin.users.create.submit')}</button
		>
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
		color: var(--readable-muted);
		font-size: 0.9em;
		margin: 0;
	}
	.error {
		color: var(--readable-bad);
		font-weight: 600;
		padding-inline-start: var(--space-2);
		border-inline-start: 3px solid var(--bad);
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
