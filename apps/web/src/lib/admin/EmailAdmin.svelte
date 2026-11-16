<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { user } from '$lib/auth';
	import ReauthFields from './ReauthFields.svelte';
	import { reauthBody, reauthError, reauthFocus, reauthNeedsCode, reauthReady } from './reauth';
	import { apiErrorBody } from '$lib/api/client';
	import { deleteSmtp, getSmtp, putSmtp, testSmtp, type SmtpSettings } from '$lib/api/adminSettings';
	import { PLAIN_WARNING, draftFrom, passwordNote, payloadFrom, portForMode, testFailure, type SmtpDraft, type TlsMode } from './smtpForm';

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
			error = apiErrorBody(err)?.message || 'Could not load the email settings.';
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
				// the administrator's own re-authentication was refused (password_required
				// here can also mean the mail account's password, so it keeps the server's sentence)
				refused = body!.error;
				error = reauthError(refused);
			} else {
				error = body?.message || fallback;
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
			status = 'Email settings saved.';
		}, 'Could not save the email settings.', () => saveFields);
	};

	const sendTest = () =>
		run(async () => {
			await testSmtp({ ...(testTo.trim() ? { to: testTo.trim() } : {}), draft: payloadFrom(draft!) });
			status = 'Test mail sent. Check the inbox.';
		}, 'Could not send the test mail.');

	const remove = () =>
		run(async () => {
			await deleteSmtp(reauthBody(ownPassword, needsCode, ownCode));
			ownPassword = ownCode = '';
			saved = await getSmtp();
			draft = draftFrom(saved);
			confirmRemove = false;
			status = 'Email setup removed.';
		}, 'Could not remove the email setup.', () => removeFields);
</script>

<section aria-labelledby="admin-email-heading">
	<h2 id="admin-email-heading">Email</h2>
	<p class="hint">A mail server lets people reset passwords, confirm addresses, get sign-in codes and lets you require two-step sign-in.</p>
	{#if error}<p class="error" role="alert">{error}</p>{/if}
	<p class="ok" role="status">{status}</p>
	{#if saved && draft}
		{#if saved.secret !== 'ok'}
			<p class="hint">QINQIN_SECRET is {saved.secret}: a mail password cannot be stored. A relay without a password still works.</p>
		{/if}
		{#if (saved.usersDependOnMail ?? 0) > 0 && (!saved.configured || saved.password === 'undecryptable')}
			<p class="error" role="alert">
				{saved.usersDependOnMail} {saved.usersDependOnMail === 1 ? 'person has' : 'people have'} email codes as their only second step and cannot sign in while email does not work. Fix the setup below, or reset their two-factor under Users.
			</p>
		{/if}
		<form onsubmit={save} class="stack">
			<label>Server <input name="host" bind:value={draft.host} required /></label>
			<label>
				Connection security
				<select name="tls" value={draft.tls} onchange={(e) => changeMode(e.currentTarget.value as TlsMode)}>
					<option value="starttls">STARTTLS (port 587)</option>
					<option value="tls">TLS (port 465)</option>
					<option value="none">None (port 25)</option>
				</select>
			</label>
			{#if draft.tls === 'none'}<p class="warn" role="note">{PLAIN_WARNING}</p>{/if}
			<label>Port <input name="port" type="number" min="1" max="65535" bind:value={draft.port} required /></label>
			<label>User name <input name="username" autocomplete="off" bind:value={draft.username} /></label>
			<fieldset>
				<legend>Password</legend>
				<p>{passwordNote(saved.password)}</p>
				{#if saved.password !== 'none' && draft.passwordChoice === 'keep'}
					<button type="button" onclick={() => (draft!.passwordChoice = 'replace')}>Replace</button>
					<button type="button" onclick={() => ((draft!.passwordChoice = 'remove'), (draft!.password = ''))}>Remove</button>
				{:else}
					{#if draft.passwordChoice === 'remove'}
						<p class="hint">The password will be removed when you save.</p>
						<button type="button" onclick={() => (draft!.passwordChoice = 'keep')}>Keep it</button>
					{:else}
						<label>
							New password
							<input type="password" name="password" autocomplete="new-password" bind:value={draft.password}
								oninput={() => (draft!.passwordChoice = 'replace')} />
						</label>
					{/if}
				{/if}
			</fieldset>
			<label>Sender address <input name="from" type="email" bind:value={draft.fromAddress} required /></label>
			<label>Sender name <input name="fromName" bind:value={draft.fromName} /></label>
			<label>Address of this site <input name="publicUrl" type="url" placeholder="https://qinqin.example.org" bind:value={draft.publicUrl} required /></label>
			{#if !confirmRemove}
				<ReauthFields bind:this={saveFields} bind:password={ownPassword} bind:code={ownCode} {needsCode} passwordLabel="Your own password, to save" />
			{/if}
			<div class="actions"><button type="submit" disabled={busy || confirmRemove || !reauthOk}>Save</button></div>
		</form>

		<h3>Test mail</h3>
		<label>Send to (default: your own address) <input name="to" type="email" bind:value={testTo} /></label>
		<button type="button" disabled={busy || !draft.host} onclick={sendTest}>Send test mail</button>

		{#if saved.configured}
			<h3>Remove email setup</h3>
			{#if confirmRemove}
				<p>This turns off password reset by email, email codes and required two-step sign-in. Personal authenticator apps keep working.</p>
				<ReauthFields bind:this={removeFields} bind:password={ownPassword} bind:code={ownCode} {needsCode} passwordLabel="Your own password, to remove" />
				<button type="button" disabled={busy || !reauthOk} onclick={remove}>Yes, remove</button>
				<button type="button" onclick={() => ((confirmRemove = false), (ownPassword = ownCode = ''))}>Cancel</button>
			{:else}
				<button type="button" onclick={() => ((confirmRemove = true), (ownPassword = ownCode = ''))}>Remove email setup…</button>
			{/if}
		{/if}
	{/if}
</section>
