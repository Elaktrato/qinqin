<script lang="ts">
	import { onMount } from 'svelte';
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

	let settings = $state<AuthSettings | null>(null);
	let error = $state('');
	let status = $state('');
	let busy = $state(false);
	let signOutOthers = $state(false);

	let events = $state<AuditEvent[]>([]);
	let next = $state<number | null>(null);
	let auditError = $state('');

	const switches = $derived(settings ? switchStates(settings) : null);

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

	async function change(patch: Parameters<typeof patchAuthSettings>[0], saved: string): Promise<void> {
		if (busy) return;
		busy = true;
		error = status = '';
		try {
			settings = await patchAuthSettings(patch);
			status = saved;
		} catch (err) {
			error = message(err, 'Could not save the setting.');
		} finally {
			busy = false;
		}
	}
</script>

<section aria-labelledby="admin-security-heading">
	<h2 id="admin-security-heading">Security</h2>
	{#if error}<p class="error" role="alert">{error}</p>{/if}
	<p class="ok" role="status">{status}</p>

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
						disabled={busy}
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
						disabled={busy}
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
						disabled={busy}
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
						disabled={busy}
						onchange={(e) => change({ emailCodeLogin: e.currentTarget.checked }, 'Email sign-in code setting saved.')}
					/>
					<span>Allow signing in with an emailed code</span>
				</label>
			{:else}
				<p class="hint">Two-factor enforcement and email sign-in codes: {switches.mfa.reason}</p>
			{/if}
		</fieldset>
	{/if}

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
