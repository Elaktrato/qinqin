<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { user } from '$lib/auth';
	import ReauthFields from './ReauthFields.svelte';
	import { reauthBody, reauthError, reauthFocus, reauthNeedsCode, reauthReady } from './reauth';
	import { apiErrorBody } from '$lib/api/client';
	import { errorText } from '$lib/api/apiErrors';
	import { t } from '$lib/i18n';
	import { deleteSmtp, getSmtp, putSmtp, testSmtp, type SmtpSettings } from '$lib/api/adminSettings';
	import { plainWarning, draftFrom, passwordNote, payloadFrom, portForMode, testFailure, type SmtpDraft, type TlsMode } from './smtpForm';

	let saved = $state<SmtpSettings | null>(null);
	let draft = $state<SmtpDraft | null>(null);
	let error = $state('');
	let status = $state('');
	let busy = $state(false);
	let testTo = $state('');
	let confirmRemove = $state(false);
	// Saving and removing re-authenticate the administrator: every auth mail
	// goes through these settings and carries the public URL.
	let ownPassword = $state('');
	let ownCode = $state('');
	let sawCodeInvalid = $state(false);
	const needsCode = $derived(reauthNeedsCode($user?.mfa?.totp, sawCodeInvalid));
	const reauthOk = $derived(reauthReady(ownPassword, needsCode, ownCode));
	let saveFields = $state<ReturnType<typeof ReauthFields> | null>(null);
	let removeFields = $state<ReturnType<typeof ReauthFields> | null>(null);

	onMount(async () => {
		try {
			saved = await getSmtp();
			draft = draftFrom(saved);
		} catch (err) {
			error = errorText(err, t('admin.email.error.load'));
		}
	});

	function changeMode(next: TlsMode) {
		if (!draft) return;
		draft.port = portForMode(draft.port, draft.tls, next);
		draft.tls = next;
	}

	async function run(fn: () => Promise<void>, fallback: string, reauthFields?: () => ReturnType<typeof ReauthFields> | null) {
		if (busy) return;
		busy = true;
		error = status = '';
		let refused = '';
		try {
			await fn();
		} catch (err) {
			const body = apiErrorBody(err);
			if (body?.error === 'smtp_test_failed') {
				const raw = JSON.parse((err as Error).message) as { category?: string; smtpCode?: number };
				error = testFailure(raw.category ?? '', raw.smtpCode);
			} else if (reauthFields && ['wrong_password', 'code_invalid', 'rate_limited'].includes(body?.error ?? '')) {
				// the administrator's own re-authentication was refused
				refused = body!.error;
				error = reauthError(refused);
			} else if (reauthFields && body?.error === 'password_required' && ownPassword !== '') {
				// The own password was sent, so the code is about the mail account: a user name needs a password.
				error = t('admin.email.error.usernameNeedsPassword');
			} else {
				error = errorText(err, fallback);
			}
		} finally {
			busy = false;
		}
		if (refused && reauthFields) {
			if (refused === 'code_invalid') sawCodeInvalid = true;
			const f = reauthFocus(refused);
			if (f.clear === 'code') ownCode = '';
			if (f.clear === 'password') ownPassword = '';
			await tick();
			reauthFields()?.focusField(f.focus);
		}
	}

	const save = (event: SubmitEvent) => {
		event.preventDefault();
		if (!draft || !reauthOk) return;
		void run(async () => {
			saved = await putSmtp({ ...payloadFrom(draft!), ...reauthBody(ownPassword, needsCode, ownCode) });
			draft = draftFrom(saved);
			ownPassword = ownCode = '';
			status = t('admin.email.saved');
		}, t('admin.email.error.save'), () => saveFields);
	};

	const sendTest = () =>
		run(async () => {
			await testSmtp({ ...(testTo.trim() ? { to: testTo.trim() } : {}), draft: payloadFrom(draft!) });
			status = t('admin.email.testSent');
		}, t('admin.email.error.test'));

	const remove = () =>
		run(async () => {
			await deleteSmtp(reauthBody(ownPassword, needsCode, ownCode));
			ownPassword = ownCode = '';
			saved = await getSmtp();
			draft = draftFrom(saved);
			confirmRemove = false;
			status = t('admin.email.removed');
		}, t('admin.email.error.remove'), () => removeFields);
</script>

<section aria-labelledby="admin-email-heading">
	<h2 id="admin-email-heading">{t('admin.email.title')}</h2>
	<p class="hint">{t('admin.email.intro')}</p>
	{#if error}<p class="error" role="alert">{error}</p>{/if}
	<p class="ok" role="status">{status}</p>
	{#if saved && draft}
		{#if saved.secret !== 'ok'}
			<p class="hint">{t('admin.email.secretState', { state: String(saved.secret) })}</p>
		{/if}
		{#if (saved.usersDependOnMail ?? 0) > 0 && (!saved.configured || saved.password === 'undecryptable')}
			<p class="error" role="alert">
				{t('admin.email.dependents', { count: saved.usersDependOnMail ?? 0 })}
			</p>
		{/if}
		<form onsubmit={save} class="stack">
			<label>{t('admin.email.server')} <input name="host" bind:value={draft.host} required /></label>
			<label>
				{t('admin.email.security')}
				<select name="tls" value={draft.tls} onchange={(e) => changeMode(e.currentTarget.value as TlsMode)}>
					<option value="starttls">{t('admin.email.security.starttls')}</option>
					<option value="tls">{t('admin.email.security.tls')}</option>
					<option value="none">{t('admin.email.security.none')}</option>
				</select>
			</label>
			{#if draft.tls === 'none'}<p class="warn" role="note">{plainWarning()}</p>{/if}
			<label>{t('admin.email.port')} <input name="port" type="number" min="1" max="65535" bind:value={draft.port} required /></label>
			<label>{t('admin.email.username')} <input name="username" autocomplete="off" bind:value={draft.username} /></label>
			<fieldset>
				<legend>{t('admin.email.password')}</legend>
				<p>{passwordNote(saved.password)}</p>
				{#if saved.password !== 'none' && draft.passwordChoice === 'keep'}
					<button type="button" onclick={() => (draft!.passwordChoice = 'replace')}>{t('admin.email.password.replace')}</button>
					<button type="button" onclick={() => ((draft!.passwordChoice = 'remove'), (draft!.password = ''))}>{t('admin.email.password.remove')}</button>
				{:else}
					{#if draft.passwordChoice === 'remove'}
						<p class="hint">{t('admin.email.password.willRemove')}</p>
						<button type="button" onclick={() => (draft!.passwordChoice = 'keep')}>{t('admin.email.password.keep')}</button>
					{:else}
						<label>
							{t('admin.email.password.new')}
							<input type="password" name="password" autocomplete="new-password" bind:value={draft.password}
								oninput={() => (draft!.passwordChoice = 'replace')} />
						</label>
					{/if}
				{/if}
			</fieldset>
			<label>{t('admin.email.senderAddress')} <input name="from" type="email" bind:value={draft.fromAddress} required /></label>
			<label>{t('admin.email.senderName')} <input name="fromName" bind:value={draft.fromName} /></label>
			<label>{t('admin.email.siteAddress')} <input name="publicUrl" type="url" placeholder="https://qinqin.example.org" bind:value={draft.publicUrl} required /></label>
			{#if !confirmRemove}
				<ReauthFields bind:this={saveFields} bind:password={ownPassword} bind:code={ownCode} {needsCode} passwordLabel={t('admin.email.ownPasswordSave')} />
			{/if}
			<div class="actions"><button type="submit" disabled={busy || confirmRemove || !reauthOk}>{t('admin.email.save')}</button></div>
		</form>

		<h3>{t('admin.email.test.title')}</h3>
		<label>{t('admin.email.test.to')} <input name="to" type="email" bind:value={testTo} /></label>
		<button type="button" disabled={busy || !draft.host} onclick={sendTest}>{t('admin.email.test.send')}</button>

		{#if saved.configured}
			<h3>{t('admin.email.remove.title')}</h3>
			{#if confirmRemove}
				<p>{t('admin.email.remove.text')}</p>
				<ReauthFields bind:this={removeFields} bind:password={ownPassword} bind:code={ownCode} {needsCode} passwordLabel={t('admin.email.ownPasswordRemove')} />
				<button type="button" disabled={busy || !reauthOk} onclick={remove}>{t('admin.email.remove.yes')}</button>
				<button type="button" onclick={() => ((confirmRemove = false), (ownPassword = ownCode = ''))}>{t('common.action.cancel')}</button>
			{:else}
				<button type="button" onclick={() => ((confirmRemove = true), (ownPassword = ownCode = ''))}>{t('admin.email.remove.open')}</button>
			{/if}
		{/if}
	{/if}
</section>
