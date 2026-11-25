<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { apiErrorBody } from '$lib/api/client';
	import { errorText } from '$lib/api/apiErrors';
	import { t, type MessageKey } from '$lib/i18n';
	import { formatDateTime } from '$lib/i18n/format';
	import type { EmailPolicy, Registration } from '$lib/api/adminSettings';
	import {
		getAuthSettings,
		listAudit,
		patchAuthSettings,
		type AuditEvent,
		type AuthSettings
	} from '$lib/api/adminSettings';
	import { EMAIL_CHOICES, REGISTRATION_CHOICES, auditLine, switchStates } from './securityView';
	import ReauthFields from './ReauthFields.svelte';
	import { settingsPatchNeedsReauth, type SettingsPatch } from './adminReauthRules';
	import { reauthBody, reauthError, reauthFocus, reauthNeedsCode, reauthReady, type Reauth } from './reauth';
	import { Button, Section } from '$lib/ui';
	import { useApp } from '$lib/context/context';
	const app = useApp();

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
	const needsCode = $derived(reauthNeedsCode(app.auth.user?.mfa?.totp, sawCodeInvalid));
	let fields = $state<ReturnType<typeof ReauthFields> | null>(null);
	// Bumped to redraw the controls from the stored settings (after Cancel or a refusal).
	let shown = $state(0);

	function cancelPending(): void {
		pending = null;
		ownPassword = ownCode = '';
		// the radio or checkbox the person clicked shows the stored value again
		shown++;
	}

	const message = errorText;

	const REGISTRATION_SAVED: Record<Registration, MessageKey> = {
		closed: 'admin.security.saved.registration.closed',
		invite: 'admin.security.saved.registration.invite',
		open: 'admin.security.saved.registration.open'
	};
	const EMAIL_SAVED: Record<EmailPolicy, MessageKey> = {
		off: 'admin.security.saved.email.off',
		optional: 'admin.security.saved.email.optional',
		required: 'admin.security.saved.email.required'
	};

	async function loadAudit(before?: number): Promise<void> {
		try {
			const page = await listAudit(before);
			events = before === undefined ? page.events : [...events, ...page.events];
			next = page.next;
			auditError = '';
		} catch (err) {
			auditError = message(err, t('admin.security.error.log'));
		}
	}

	onMount(async () => {
		try {
			settings = await getAuthSettings();
		} catch (err) {
			error = message(err, t('admin.security.error.load'));
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
			const fallback = message(err, t('admin.security.error.save'));
			error = reauth ? reauthError(kind, fallback) : fallback;
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

<Section title={t('admin.security.title')}>
	{#if error}<p class="error" role="alert">{error}</p>{/if}
	<p class="ok" role="status">{status}</p>

	{#if pending}
		<form
			class="confirm"
			aria-label={t('admin.security.confirm.label')}
			onsubmit={(event) => {
				event.preventDefault();
				const p = pending;
				if (p && reauthReady(ownPassword, needsCode, ownCode)) void change(p.patch, p.saved, reauthBody(ownPassword, needsCode, ownCode));
			}}
		>
			<p>{t('admin.security.confirm.text')}</p>
			<ReauthFields bind:this={fields} bind:password={ownPassword} bind:code={ownCode} {needsCode} passwordLabel={t('admin.security.confirm.ownPassword')} />
			<Button type="submit" variant="primary" disabled={busy || !reauthReady(ownPassword, needsCode, ownCode)}
				>{t('admin.security.confirm.submit')}</Button
			>
			<Button onclick={cancelPending}>{t('common.action.cancel')}</Button>
		</form>
	{/if}

	{#key shown}
	{#if settings && switches}
		<fieldset>
			<legend>{t('admin.security.registration')}</legend>
			{#each REGISTRATION_CHOICES as c (c.value)}
				<label class="choice">
					<input
						type="radio"
						name="registration"
						value={c.value}
						checked={settings.registration === c.value}
						disabled={busy || !!pending}
						onchange={() => change({ registration: c.value }, t(REGISTRATION_SAVED[c.value]))}
					/>
					<span><strong>{c.label}</strong> {c.hint}</span>
				</label>
			{/each}
		</fieldset>

		<fieldset>
			<legend>{t('admin.security.emailAddresses')}</legend>
			{#each EMAIL_CHOICES as c (c.value)}
				<label class="choice">
					<input
						type="radio"
						name="email-policy"
						value={c.value}
						checked={settings.emailPolicy === c.value}
						disabled={busy || !!pending}
						onchange={() => change({ emailPolicy: c.value }, t(EMAIL_SAVED[c.value]))}
					/>
					<span><strong>{c.label}</strong> {c.hint}</span>
				</label>
			{/each}
		</fieldset>

		<fieldset>
			<legend>{t('admin.security.signIn')}</legend>
			{#if switches.mfa.available}
				<label class="choice">
					<input
						type="checkbox"
						checked={settings.mfaEnforced}
						disabled={busy || !!pending}
						onchange={(e) => change({ mfaEnforced: e.currentTarget.checked, ...(e.currentTarget.checked && signOutOthers ? { signOutOthers: true } : {}) }, t('admin.security.saved.mfa'))}
					/>
					<span>{t('admin.security.requireMfa')}</span>
				</label>
				<label class="choice">
					<input type="checkbox" bind:checked={signOutOthers} />
					<span>{t('admin.security.signOutOthers')}</span>
				</label>
				{#if !app.auth.user?.mfa?.totp}
					<p class="hint">{t('admin.security.noOwnAuthenticator')}</p>
				{/if}
				{#if settings.mfaEnforced && settings.mfaEnforcedEffective === false}
					<p class="hint">{t('admin.security.mfaInactive')}</p>
				{/if}
				<label class="choice">
					<input
						type="checkbox"
						checked={settings.emailCodeLogin}
						disabled={busy || !!pending}
						onchange={(e) => change({ emailCodeLogin: e.currentTarget.checked }, t('admin.security.saved.emailCode'))}
					/>
					<span>{t('admin.security.allowEmailCode')}</span>
				</label>
			{:else}
				<p class="hint">{t('admin.security.switchesUnavailable', { reason: switches.mfa.reason })}</p>
			{/if}
		</fieldset>
	{/if}
	{/key}

	<h3>{t('admin.security.activity')}</h3>
	{#if auditError}<p class="error" role="alert">{auditError}</p>{/if}
	{#if events.length > 0}
		<ul class="audit" aria-label={t('admin.security.recentActivity')}>
			{#each events as e (e.id)}
				<li><time datetime={e.at}>{formatDateTime(e.at)}</time> {auditLine(e)}</li>
			{/each}
		</ul>
		{#if next !== null}
			<Button onclick={() => loadAudit(next ?? undefined)}>{t('admin.security.loadOlder')}</Button>
		{/if}
	{:else}
		<p class="hint">{t('admin.security.nothingYet')}</p>
	{/if}
</Section>

<style>
	fieldset {
		margin: 0 0 var(--space-5);
		display: grid;
		gap: var(--space-2);
		max-width: 40rem;
	}

	.choice {
		display: flex;
		gap: var(--space-2);
		align-items: flex-start;
		min-height: var(--hit);
	}

	.confirm {
		display: grid;
		gap: var(--space-3);
		margin-block: var(--space-4);
		padding-block: var(--space-4);
		border-top: 1px solid var(--hair);
		max-width: 40rem;
	}

	h3 {
		margin: var(--space-5) 0 var(--space-2);
		font-size: var(--font-size-l);
		font-weight: var(--weight-strong);
	}

	.audit {
		list-style: none;
		margin: 0 0 var(--space-4);
		padding: 0;
		display: grid;
		gap: var(--space-1);
	}

	time {
		color: var(--readable-muted);
		margin-right: var(--space-2);
	}

	.hint {
		color: var(--readable-muted);
	}

	.error {
		color: var(--readable-bad);
		padding-inline-start: var(--space-2);
		border-inline-start: 3px solid var(--bad);
	}

	.ok {
		min-height: 1.2em;
		margin-block: var(--space-1);
	}
</style>
