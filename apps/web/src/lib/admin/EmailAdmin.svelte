<script lang="ts">
	import { onMount } from 'svelte';
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

	async function run(fn: () => Promise<void>, fallback: string) {
		if (busy) return;
		busy = true;
		error = status = '';
		try {
			await fn();
		} catch (err) {
			const body = apiErrorBody(err);
			if (body?.error === 'smtp_test_failed') {
				const raw = JSON.parse((err as Error).message) as { category?: string; smtpCode?: number };
				error = testFailure(raw.category ?? '', raw.smtpCode);
			} else {
				error = body?.message || fallback;
			}
		} finally {
			busy = false;
		}
	}

	const save = (event: SubmitEvent) => {
		event.preventDefault();
		if (!draft) return;
		void run(async () => {
			saved = await putSmtp(payloadFrom(draft!));
			draft = draftFrom(saved);
			status = 'Email settings saved.';
		}, 'Could not save the email settings.');
	};

	const sendTest = () =>
		run(async () => {
			await testSmtp({ ...(testTo.trim() ? { to: testTo.trim() } : {}), draft: payloadFrom(draft!) });
			status = 'Test mail sent. Check the inbox.';
		}, 'Could not send the test mail.');

	const remove = () =>
		run(async () => {
			await deleteSmtp();
			saved = await getSmtp();
			draft = draftFrom(saved);
			confirmRemove = false;
			status = 'Email setup removed.';
		}, 'Could not remove the email setup.');
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
			<div class="actions"><button type="submit" disabled={busy}>Save</button></div>
		</form>

		<h3>Test mail</h3>
		<label>Send to (default: your own address) <input name="to" type="email" bind:value={testTo} /></label>
		<button type="button" disabled={busy || !draft.host} onclick={sendTest}>Send test mail</button>

		{#if saved.configured}
			<h3>Remove email setup</h3>
			{#if confirmRemove}
				<p>This turns off password reset by email, email codes and required two-step sign-in. Personal authenticator apps keep working.</p>
				<button type="button" disabled={busy} onclick={remove}>Yes, remove</button>
				<button type="button" onclick={() => (confirmRemove = false)}>Cancel</button>
			{:else}
				<button type="button" onclick={() => (confirmRemove = true)}>Remove email setup…</button>
			{/if}
		{/if}
	{/if}
</section>
