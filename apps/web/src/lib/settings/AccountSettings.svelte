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
	import AppSection from '$lib/pwa/AppSection.svelte';
	import AccessTokens from './AccessTokens.svelte';
	import { containmentNote } from '$lib/account/tokensView';
	import { Button, Field, Section, Select } from '$lib/ui';
	import { useApp } from '$lib/context/context';
	const app = useApp();

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
	const emailView = $derived(emailSection(emailPolicy, app.auth.user?.email ?? null));

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
			await app.auth.loadMe();
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
	let languageDraft = $state(app.auth.user?.interfaceLanguage ?? '');
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
			passwordProblem(app.auth.user?.username ?? '', next) ?? confirmProblem(next, confirm);
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
			app.auth.logout();
		} catch (err) {
			sessionsError = errorText(err, t('settings.account.sessions.error.all'));
			confirmingAll = false;
		} finally {
			busy = false;
		}
	}
</script>

<Section title={t('settings.account.profile.title')}>
	<p>
		<Msg key="settings.account.profile.username" args={{ name: app.auth.user?.username ?? '' }}
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
				{#if app.auth.user?.email}{t('settings.account.email.current', { email: app.auth.user.email })}{:else}{t(
						'settings.account.email.none'
					)}{/if}
			</p>
			<Field label={emailView.label} type="email" autocomplete="email" bind:value={emailDraft} />
			<Field
				label={t('account.field.yourPassword')}
				type="password"
				autocomplete="current-password"
				bind:value={emailPassword}
				required
			/>
			{#if app.auth.user?.mfa?.totp}
				<label>
					{t('settings.account.email.code')}
					<input name="email-code" autocomplete="one-time-code" bind:value={emailCode} required />
				</label>
			{/if}
			{#if emailError}<p class="error" role="alert">{emailError}</p>{/if}
			<p class="ok" role="status">{emailDone}</p>
			<div class="actions">
				<Button type="submit" variant="primary" disabled={emailBusy || emailDraft.trim() === ''}
					>{t('settings.account.email.save')}</Button
				>
				{#if emailView.canClear}
					<Button tone="danger" disabled={emailBusy || emailPassword === ''} onclick={() => saveEmail(null)}
						>{t('settings.account.email.remove')}</Button
					>
				{/if}
			</div>
		</form>
		{#if app.auth.user?.email && !app.auth.user.emailVerified && mailAvailable(optionsAll)}
			{#if verifying}
				<EmailVerify address={app.auth.user.email} onverified={async () => { verifying = false; await app.auth.loadMe(); }} />
			{:else}
				<p class="hint">{t('settings.account.email.unconfirmed')}
					<Button variant="plain" onclick={() => (verifying = true)}>{t('settings.account.email.confirm')}</Button></p>
			{/if}
		{/if}
	{/if}
</Section>

<Section title={t('settings.account.interfaceLanguage.title')}>
	<form onsubmit={saveLanguage} class="stack">
		<Select
			label={t('settings.account.interfaceLanguage.label')}
			bind:value={languageDraft}
			aria-describedby="account-language-hint"
			options={[
				{ value: '', label: t('settings.account.interfaceLanguage.browser', { language: browserDefault }) },
				...languageChoices.map((choice) => ({ value: choice.code, label: choice.label }))
			]}
		/>
		<p class="hint" id="account-language-hint">{t('settings.account.interfaceLanguage.hint')}</p>
		{#if languageError}<p class="error" role="alert">{languageError}</p>{/if}
		{#if languageNotice}<p class="hint" role="status">{languageNotice}</p>{/if}
		<Button type="submit" variant="primary" disabled={languageBusy}
			>{languageBusy ? t('settings.account.interfaceLanguage.saving') : t('settings.account.interfaceLanguage.save')}</Button
		>
	</form>
</Section>

<TwoFactorManage options={optionsAll} />

<Section title={t('settings.account.password.title')}>
	<form onsubmit={submitPassword} class="stack">
		<Field
			label={t('settings.account.password.current')}
			type="password"
			autocomplete="current-password"
			bind:value={current}
			required
		/>
		<Field
			label={t('settings.account.password.new')}
			type="password"
			autocomplete="new-password"
			aria-describedby="account-password-rules"
			bind:value={next}
			required
		/>
		<p class="hint" id="account-password-rules">{passwordHint()}</p>
		<Field
			label={t('settings.account.password.repeat')}
			type="password"
			autocomplete="new-password"
			bind:value={confirm}
			required
		/>
		<label class="check">
			<input type="checkbox" bind:checked={signOutOthers} />
			{t('settings.account.password.signOutOthers')}
		</label>
		{#if tokenNote}<p class="hint">{tokenNote}</p>{/if}
		{#if pwError}<p class="error" role="alert">{pwError}</p>{/if}
		<p class="ok" role="status">{pwDone}</p>
		<Button type="submit" variant="primary" disabled={pwBusy}
			>{pwBusy ? t('settings.account.password.changing') : t('settings.account.password.change')}</Button
		>
	</form>
</Section>

<Section title={t('settings.account.sessions.title')}>
	<p class="hint">{t('settings.account.sessions.intro')}</p>
	{#if sessionsError}<p class="error" role="alert">{sessionsError}</p>{/if}
	{#if sessionsLoaded && rows.length > 0}
		<table class="ui-table" aria-label={t('settings.account.sessions.table')}>
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
								<Button
									disabled={busy}
									aria-label={t('settings.account.sessions.revokeNamed', { device: row.deviceLabel })}
									onclick={() => revokeOne(row.id)}>{t('settings.tokens.revoke')}</Button
								>
							{/if}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
	<div class="actions">
		<Button disabled={busy || !hasOthers} onclick={revokeOthers}>{t('settings.account.sessions.logoutOthers')}</Button>
		<Button disabled={busy} onclick={() => (confirmingAll = true)}>{t('settings.account.sessions.logoutAll')}</Button>
	</div>
	{#if tokenNote}<p class="hint">{t('settings.account.sessions.tokenNote', { note: tokenNote })}</p>{/if}
	{#if confirmingAll}
		<div class="confirm" role="group" aria-label={t('settings.account.sessions.confirmAll')}>
			<p>{logoutEverywhereConfirm()}{#if tokenNote}{' '}{tokenNote}{/if}</p>
			<Button tone="danger" disabled={busy} onclick={revokeAll}>{t('settings.account.sessions.confirmAllYes')}</Button>
			<Button disabled={busy} onclick={() => (confirmingAll = false)}>{t('common.action.cancel')}</Button>
		</div>
	{/if}
</Section>

{#key tokensKey}
	<AccessTokens oncount={(n) => (tokenCount = n)} />
{/key}

<YourData />

<AppSection />

<Section title={t('settings.account.delete.title')}>
	<p class="hint">{t('settings.account.delete.intro')}</p>
	<Button tone="danger" onclick={() => (deleting = true)}>{t('settings.account.delete.open')}</Button>
</Section>

{#if deleting && app.auth.user}
	<DeleteAccountDialog
		username={app.auth.user.username}
		onclose={() => (deleting = false)}
		ondone={() => {
			deleting = false;
			// The account is gone: its unsent reviews can never be sent.
			if (app.auth.user) app.session?.outbox.clearPending(app.auth.user.id);
			app.auth.logout();
		}}
	/>
{/if}

<style>
	.stack {
		display: grid;
		gap: var(--space-3);
		max-width: 24rem;
	}

	label.check {
		display: flex;
		gap: var(--space-2);
		align-items: center;
		min-height: var(--hit);
	}

	.hint {
		margin: 0;
		color: var(--readable-muted);
	}

	.error {
		margin: 0;
		color: var(--readable-bad);
		padding-inline-start: var(--space-2);
		border-inline-start: 3px solid var(--bad);
	}

	.ok {
		margin: 0;
		min-height: 1.2em;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	.confirm {
		margin-top: var(--space-3);
		padding-block: var(--space-3);
		border-top: 1px solid var(--hair);
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		align-items: center;
	}

	.confirm p {
		flex-basis: 100%;
		margin: 0;
	}
</style>
