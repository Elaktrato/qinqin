<script lang="ts">
	import { onMount } from 'svelte';
	import { apiErrorBody } from '$lib/api/client';
	import { errorText } from '$lib/api/apiErrors';
	import { t } from '$lib/i18n';
	import Msg from '$lib/i18n/Msg.svelte';
	import { putInterfaceLanguage } from '$lib/api/interfaceLanguage';
	import { SUPPORTED_LANGUAGES } from '$lib/i18n/negotiate';
	import { resolveInterfaceLanguage, switchInterfaceLanguage } from '$lib/i18n/interfaceLanguage';
	import { languageName } from '$lib/i18n/format';
	import { reloadPage } from '$lib/i18n/reloadPage';
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
	import YourData from '$lib/account/YourData.svelte';
	import TwoFactorManage from '$lib/account/TwoFactorManage.svelte';
	import EmailVerify from '$lib/account/EmailVerify.svelte';
	import { mailAvailable } from '$lib/account/mfaView';
	import { confirmProblem, passwordHint, passwordProblem } from '$lib/account/passwordRules';
	import {
		logoutEverywhereConfirm,
		sessionRows,
		type SessionDto
	} from '$lib/account/sessionsView';
	import { loadMe, logout, user } from '$lib/auth';
	import { clearPending } from '$lib/study/events';
	import AppSection from '$lib/pwa/AppSection.svelte';
	import AccessTokens from './AccessTokens.svelte';
	import { containmentNote } from '$lib/account/tokensView';

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
	// How many access tokens exist (AccessTokens reports it): a password
	// change and the log-out actions revoke them, and say so.
	let tokenCount = $state(0);
	let tokensKey = $state(0); // bumped after a server-side revocation reloads the list
	const tokenNote = $derived(containmentNote(tokenCount));
	const hasOthers = $derived(rows.some((r) => r.canRevoke));

	async function loadSessions(): Promise<void> {
		try {
			sessions = await listSessions();
			sessionsError = '';
		} catch (err) {
			sessionsError = errorText(err, t('settings.account.sessions.error.load'));
		} finally {
			sessionsLoaded = true;
		}
	}

	// Profile: the email field follows the instance policy.
	let emailPolicy = $state<AuthOptions['emailPolicy'] | null>(null);
	let emailDraft = $state('');
	let emailPassword = $state('');
	let emailCode = $state('');
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
			const res = await putEmail(next, emailPassword, emailCode.trim() || undefined);
			verifying = res.verification === 'sent';
			emailDone =
				next === null
					? t('settings.account.email.removed')
					: verifying
						? t('settings.account.email.savedConfirm')
						: t('settings.account.email.saved');
			emailPassword = emailDraft = emailCode = '';
			await loadMe();
		} catch (err) {
			emailError = errorText(err, t('settings.account.email.error'));
		} finally {
			emailBusy = false;
		}
	}

	// Interface language: '' follows the browser; each supported language is named in itself.
	const browserLanguages = typeof navigator === 'undefined' ? [] : (navigator.languages ?? [navigator.language]);
	const languageChoices = SUPPORTED_LANGUAGES.map((code) => ({ code, label: languageName(code, code) }));
	const browserDefault = languageName(resolveInterfaceLanguage('', browserLanguages), resolveInterfaceLanguage('', browserLanguages));
	let languageDraft = $state($user?.interfaceLanguage ?? '');
	let languageBusy = $state(false);
	let languageError = $state('');
	let languageNotice = $state('');

	async function saveLanguage(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (languageBusy) return;
		languageBusy = true;
		languageError = '';
		languageNotice = '';
		try {
			const res = await putInterfaceLanguage(languageDraft);
			let storage: Storage | null = null;
			try {
				storage = localStorage;
			} catch {
				storage = null;
			}
			const resolved = resolveInterfaceLanguage(res.language, browserLanguages);
			if (!switchInterfaceLanguage(resolved, { storage, reload: reloadPage })) {
				languageNotice = t('settings.account.interfaceLanguage.storageBlocked');
				languageBusy = false;
			}
		} catch (err) {
			languageError = errorText(err, t('settings.account.interfaceLanguage.error'));
			languageBusy = false;
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
			pwDone =
				(signOutOthers ? t('settings.account.password.changedOthersOut') : t('settings.account.password.changed')) +
				(tokenNote ? ` ${t('settings.account.password.tokensRevoked')}` : '');
			current = next = confirm = '';
			tokensKey++;
			await loadSessions();
		} catch (err) {
			// A wrong current password is a 403, so the session stays signed in.
			const body = apiErrorBody(err);
			pwError =
				body?.error === 'wrong_password'
					? t('settings.account.password.currentWrong')
					: errorText(err, t('settings.account.password.error'));
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
			sessionsError = errorText(err, t('settings.account.sessions.error.revoke'));
		} finally {
			busy = false;
		}
	}

	async function revokeOthers(): Promise<void> {
		if (busy) return;
		busy = true;
		try {
			await revokeSessions('others');
			tokensKey++;
			await loadSessions();
		} catch (err) {
			sessionsError = errorText(err, t('settings.account.sessions.error.others'));
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
			sessionsError = errorText(err, t('settings.account.sessions.error.all'));
			confirmingAll = false;
		} finally {
			busy = false;
		}
	}
</script>

<section aria-labelledby="account-profile-heading" class="block">
	<h2 id="account-profile-heading">{t('settings.account.profile.title')}</h2>
	<p>
		<Msg key="settings.account.profile.username" args={{ name: $user?.username ?? '' }}
			>{#snippet strong(text: string)}<strong>{text}</strong>{/snippet}</Msg
		>
	</p>
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
				{#if $user?.email}{t('settings.account.email.current', { email: $user.email })}{:else}{t(
						'settings.account.email.none'
					)}{/if}
			</p>
			<label>
				{emailView.label}
				<input type="email" autocomplete="email" bind:value={emailDraft} />
			</label>
			<label>
				{t('account.field.yourPassword')}
				<input type="password" autocomplete="current-password" bind:value={emailPassword} required />
			</label>
			{#if $user?.mfa?.totp}
				<label>
					{t('settings.account.email.code')}
					<input name="email-code" autocomplete="one-time-code" bind:value={emailCode} required />
				</label>
			{/if}
			{#if emailError}<p class="error" role="alert">{emailError}</p>{/if}
			<p class="ok" role="status">{emailDone}</p>
			<div class="actions">
				<button type="submit" disabled={emailBusy || emailDraft.trim() === ''}>{t('settings.account.email.save')}</button>
				{#if emailView.canClear}
					<button type="button" disabled={emailBusy || emailPassword === ''} onclick={() => saveEmail(null)}
						>{t('settings.account.email.remove')}</button
					>
				{/if}
			</div>
		</form>
		{#if $user?.email && !$user.emailVerified && mailAvailable(optionsAll)}
			{#if verifying}
				<EmailVerify address={$user.email} onverified={async () => { verifying = false; await loadMe(); }} />
			{:else}
				<p class="hint">{t('settings.account.email.unconfirmed')}
					<button type="button" class="link" onclick={() => (verifying = true)}>{t('settings.account.email.confirm')}</button></p>
			{/if}
		{/if}
	{/if}
</section>

<section aria-labelledby="account-language-heading" class="block">
	<h2 id="account-language-heading">{t('settings.account.interfaceLanguage.title')}</h2>
	<form onsubmit={saveLanguage} class="stack">
		<label>
			{t('settings.account.interfaceLanguage.label')}
			<select bind:value={languageDraft} aria-describedby="account-language-hint">
				<option value="">{t('settings.account.interfaceLanguage.browser', { language: browserDefault })}</option>
				{#each languageChoices as choice (choice.code)}
					<option value={choice.code}>{choice.label}</option>
				{/each}
			</select>
		</label>
		<p class="hint" id="account-language-hint">{t('settings.account.interfaceLanguage.hint')}</p>
		{#if languageError}<p class="error" role="alert">{languageError}</p>{/if}
		{#if languageNotice}<p class="hint" role="status">{languageNotice}</p>{/if}
		<button type="submit" disabled={languageBusy}
			>{languageBusy ? t('settings.account.interfaceLanguage.saving') : t('settings.account.interfaceLanguage.save')}</button
		>
	</form>
</section>

<TwoFactorManage options={optionsAll} />

<section aria-labelledby="account-password-heading" class="block">
	<h2 id="account-password-heading">{t('settings.account.password.title')}</h2>
	<form onsubmit={submitPassword} class="stack">
		<label>
			{t('settings.account.password.current')}
			<input type="password" autocomplete="current-password" bind:value={current} required />
		</label>
		<label>
			{t('settings.account.password.new')}
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
			{t('settings.account.password.repeat')}
			<input type="password" autocomplete="new-password" bind:value={confirm} required />
		</label>
		<label class="check">
			<input type="checkbox" bind:checked={signOutOthers} />
			{t('settings.account.password.signOutOthers')}
		</label>
		{#if tokenNote}<p class="hint">{tokenNote}</p>{/if}
		{#if pwError}<p class="error" role="alert">{pwError}</p>{/if}
		<p class="ok" role="status">{pwDone}</p>
		<button type="submit" disabled={pwBusy}>{pwBusy ? t('settings.account.password.changing') : t('settings.account.password.change')}</button>
	</form>
</section>

<section aria-labelledby="account-sessions-heading" class="block">
	<h2 id="account-sessions-heading">{t('settings.account.sessions.title')}</h2>
	<p class="hint">{t('settings.account.sessions.intro')}</p>
	{#if sessionsError}<p class="error" role="alert">{sessionsError}</p>{/if}
	{#if sessionsLoaded && rows.length > 0}
		<table aria-label={t('settings.account.sessions.table')}>
			<thead>
				<tr>
					<th scope="col">{t('settings.account.sessions.colDevice')}</th>
					<th scope="col">{t('settings.account.sessions.colSignedIn')}</th>
					<th scope="col">{t('settings.account.sessions.colLastActive')}</th>
					<th scope="col"><span class="visually-hidden">{t('settings.tokens.colActions')}</span></th>
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
									aria-label={t('settings.account.sessions.revokeNamed', { device: row.deviceLabel })}
									onclick={() => revokeOne(row.id)}>{t('settings.tokens.revoke')}</button
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
			>{t('settings.account.sessions.logoutOthers')}</button
		>
		<button type="button" disabled={busy} onclick={() => (confirmingAll = true)}
			>{t('settings.account.sessions.logoutAll')}</button
		>
	</div>
	{#if tokenNote}<p class="hint">{t('settings.account.sessions.tokenNote', { note: tokenNote })}</p>{/if}
	{#if confirmingAll}
		<div class="confirm" role="group" aria-label={t('settings.account.sessions.confirmAll')}>
			<p>{logoutEverywhereConfirm()}{#if tokenNote}{' '}{tokenNote}{/if}</p>
			<button type="button" disabled={busy} onclick={revokeAll}>{t('settings.account.sessions.confirmAllYes')}</button>
			<button type="button" disabled={busy} onclick={() => (confirmingAll = false)}>{t('common.action.cancel')}</button>
		</div>
	{/if}
</section>

{#key tokensKey}
	<AccessTokens oncount={(n) => (tokenCount = n)} />
{/key}

<YourData />

<AppSection />

<section aria-labelledby="account-delete-heading" class="block">
	<h2 id="account-delete-heading">{t('settings.account.delete.title')}</h2>
	<p class="hint">{t('settings.account.delete.intro')}</p>
	<button type="button" onclick={() => (deleting = true)}>{t('settings.account.delete.open')}</button>
</section>

{#if deleting && $user}
	<DeleteAccountDialog
		username={$user.username}
		onclose={() => (deleting = false)}
		ondone={() => {
			deleting = false;
			// The account is gone: its unsent reviews can never be sent.
			if ($user) clearPending($user.id);
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
