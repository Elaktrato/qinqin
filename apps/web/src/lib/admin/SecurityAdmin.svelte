<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { apiErrorBody } from '$lib/api/client';
	import {
		getAuthSettings,
		listAudit,
		patchAuthSettings,
		type AuditEvent,
		type AuthSettings
	} from '$lib/api/adminSettings';
	import { user } from '$lib/auth';
	import { EMAIL_CHOICES, REGISTRATION_CHOICES, auditLine, switchStates } from './securityView';
	import ReauthFields from './ReauthFields.svelte';
	import { settingsPatchNeedsReauth, type SettingsPatch } from './adminReauthRules';
	import { reauthBody, reauthError, reauthFocus, reauthNeedsCode, reauthReady, type Reauth } from './reauth';

	let settings = $state<AuthSettings | null>(null);
	let error = $state('');
	let status = $state('');
	let busy = $state(false);
	let signOutOthers = $state(false);

	let events = $state<AuditEvent[]>([]);
	let next = $state<number | null>(null);
	let auditError = $state('');

	const switches = $derived(settings ? switchStates(settings) : null);

	// A change that lowers a protection waits for the administrator's own
	// password (and code): the server's rule, docs/contracts/auth/admin-reauth.json.
	let pending = $state<{ patch: SettingsPatch; saved: string } | null>(null);
	let ownPassword = $state('');
	let ownCode = $state('');
	let sawCodeInvalid = $state(false);
	const needsCode = $derived(reauthNeedsCode($user?.mfa?.totp, sawCodeInvalid));
	let fields = $state<ReturnType<typeof ReauthFields> | null>(null);
	// Bumped to redraw the controls from the stored settings (after Cancel or a refusal).
	let shown = $state(0);

	function cancelPending(): void {
		pending = null;
		ownPassword = ownCode = '';
		// the radio or checkbox the person clicked shows the stored value again
		shown++;
	}

	function message(err: unknown, fallback: string): string {
		return apiErrorBody(err)?.message || (err instanceof Error ? err.message : '') || fallback;
	}

	async function loadAudit(before?: number): Promise<void> {
		try {
			const page = await listAudit(before);
			events = before === undefined ? page.events : [...events, ...page.events];
			next = page.next;
			auditError = '';
		} catch (err) {
			auditError = message(err, 'Could not load the log.');
		}
	}

	onMount(async () => {
		try {
			settings = await getAuthSettings();
		} catch (err) {
			error = message(err, 'Could not load the settings.');
		}
		await loadAudit();
	});

	async function change(patch: SettingsPatch, saved: string, reauth?: Reauth): Promise<void> {
		if (busy || !settings) return;
		if (!reauth && settingsPatchNeedsReauth(settings, patch)) {
			pending = { patch, saved };
			ownPassword = ownCode = '';
			error = '';
			await tick();
			fields?.focusField('password');
			return;
		}
		busy = true;
		error = status = '';
		let refused = '';
		try {
			settings = await patchAuthSettings({ ...patch, ...reauth });
			status = saved;
			pending = null;
			ownPassword = ownCode = '';
		} catch (err) {
			const kind = apiErrorBody(err)?.error ?? '';
			error = reauth ? reauthError(kind, message(err, 'Could not save the setting.')) : message(err, 'Could not save the setting.');
			refused = kind;
		} finally {
			busy = false;
		}
		if (refused && reauth) {
			if (refused === 'code_invalid') sawCodeInvalid = true;
			const f = reauthFocus(refused);
			if (f.clear === 'code') ownCode = '';
			if (f.clear === 'password') ownPassword = '';
			await tick();
			fields?.focusField(f.focus);
		} else if (refused) {
			shown++;
		}
	}
</script>

<section aria-labelledby="admin-security-heading">
	<h2 id="admin-security-heading">Security</h2>
	{#if error}<p class="error" role="alert">{error}</p>{/if}
	<p class="ok" role="status">{status}</p>

	{#if pending}
		<form
			class="confirm"
			aria-label="Confirm with your password"
			onsubmit={(event) => {
				event.preventDefault();
				const p = pending;
				if (p && reauthReady(ownPassword, needsCode, ownCode)) void change(p.patch, p.saved, reauthBody(ownPassword, needsCode, ownCode));
			}}
		>
			<p>This lowers a sign-in protection or signs people out. Confirm it with your own password.</p>
			<ReauthFields bind:this={fields} bind:password={ownPassword} bind:code={ownCode} {needsCode} passwordLabel="Your own password, to confirm this change" />
			<button type="submit" disabled={busy || !reauthReady(ownPassword, needsCode, ownCode)}>Confirm</button>
			<button type="button" onclick={cancelPending}>Cancel</button>
		</form>
	{/if}

	{#key shown}
	{#if settings && switches}
		<fieldset>
			<legend>Registration</legend>
			{#each REGISTRATION_CHOICES as c (c.value)}
				<label class="choice">
					<input
						type="radio"
						name="registration"
						value={c.value}
						checked={settings.registration === c.value}
						disabled={busy || !!pending}
						onchange={() => change({ registration: c.value }, `Registration is now ${c.label.toLowerCase()}.`)}
					/>
					<span><strong>{c.label}</strong> {c.hint}</span>
				</label>
			{/each}
		</fieldset>

		<fieldset>
			<legend>Email addresses</legend>
			{#each EMAIL_CHOICES as c (c.value)}
				<label class="choice">
					<input
						type="radio"
						name="email-policy"
						value={c.value}
						checked={settings.emailPolicy === c.value}
						disabled={busy || !!pending}
						onchange={() => change({ emailPolicy: c.value }, `Email addresses are now ${c.label.toLowerCase()}.`)}
					/>
					<span><strong>{c.label}</strong> {c.hint}</span>
				</label>
			{/each}
		</fieldset>

		<fieldset>
			<legend>Sign-in</legend>
			{#if switches.mfa.available}
				<label class="choice">
					<input
						type="checkbox"
						checked={settings.mfaEnforced}
						disabled={busy || !!pending}
						onchange={(e) => change({ mfaEnforced: e.currentTarget.checked, ...(e.currentTarget.checked && signOutOthers ? { signOutOthers: true } : {}) }, 'Two-factor policy saved.')}
					/>
					<span>Require two-factor authentication for everyone</span>
				</label>
				<label class="choice">
					<input type="checkbox" bind:checked={signOutOthers} />
					<span>Sign everyone else out now (when turning this on)</span>
				</label>
				{#if !$user?.mfa?.totp}
					<p class="hint">You have no authenticator app yourself: your own sign-in will depend on email codes.</p>
				{/if}
				{#if settings.mfaEnforced && settings.mfaEnforcedEffective === false}
					<p class="hint">Required, but inactive while no mail server is set up.</p>
				{/if}
				<label class="choice">
					<input
						type="checkbox"
						checked={settings.emailCodeLogin}
						disabled={busy || !!pending}
						onchange={(e) => change({ emailCodeLogin: e.currentTarget.checked }, 'Email sign-in code setting saved.')}
					/>
					<span>Allow signing in with an emailed code</span>
				</label>
			{:else}
				<p class="hint">Two-factor enforcement and email sign-in codes: {switches.mfa.reason}</p>
			{/if}
		</fieldset>
	{/if}
	{/key}

	<h3>Activity</h3>
	{#if auditError}<p class="error" role="alert">{auditError}</p>{/if}
	{#if events.length > 0}
		<ul class="audit" aria-label="Recent activity">
			{#each events as e (e.id)}
				<li><time datetime={e.at}>{new Date(e.at).toLocaleString()}</time> {auditLine(e)}</li>
			{/each}
		</ul>
		{#if next !== null}
			<button type="button" onclick={() => loadAudit(next ?? undefined)}>Load older</button>
		{/if}
	{:else}
		<p class="hint">Nothing has happened yet.</p>
	{/if}
</section>

<style>
	fieldset {
		margin: 0 0 1.2rem;
		border: 1px solid color-mix(in srgb, currentColor 25%, transparent);
		border-radius: 0.5rem;
		display: grid;
		gap: 0.6rem;
		max-width: 40rem;
	}
	.choice {
		display: flex;
		gap: 0.6rem;
		align-items: flex-start;
	}
	.audit {
		list-style: none;
		margin: 0 0 1rem;
		padding: 0;
		display: grid;
		gap: 0.3rem;
	}
	time {
		opacity: 0.7;
		margin-right: 0.5rem;
	}
	.hint {
		opacity: 0.8;
	}
	.error {
		color: #c62828;
		font-weight: 600;
	}
	.ok {
		min-height: 1.2em;
		margin: 0.4rem 0;
	}
</style>
