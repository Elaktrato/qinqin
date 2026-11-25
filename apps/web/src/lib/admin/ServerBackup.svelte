<script lang="ts">
	import { errorText } from '$lib/api/apiErrors';
	import { t } from '$lib/i18n';
	import Msg from '$lib/ui/Msg.svelte';
	import { apiErrorBody } from '$lib/api/client';
	import { createServerBackup } from '$lib/api/backup';
	import { PARTS, backupError, canCreate, includeBody, restoreSteps, securityNote } from './serverBackupView';
	import { tick } from 'svelte';
	import ReauthFields from './ReauthFields.svelte';
	import { reauthBody, reauthFocus, reauthNeedsCode } from './reauth';
	import { Button, Section } from '$lib/ui';
	import { useApp } from '$lib/context/context';
	const app = useApp();

	let { assign = (u: string) => location.assign(u) }: { assign?: (url: string) => void } = $props();

	let selected = $state(new Set(PARTS.map((p) => p.id)));
	let password = $state('');
	let code = $state('');
	let sawCodeInvalid = $state(false);
	const needsCode = $derived(reauthNeedsCode(app.auth.user?.mfa?.totp, sawCodeInvalid));
	let fields = $state<ReturnType<typeof ReauthFields> | null>(null);
	let busy = $state(false);
	let error = $state('');
	let started = $state(false);

	function toggle(id: string, on: boolean): void {
		const next = new Set(selected);
		if (on) next.add(id);
		else next.delete(id);
		selected = next;
	}

	async function create(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (!canCreate(selected, password, busy, needsCode, code)) return;
		busy = true;
		error = '';
		started = false;
		try {
			const r = reauthBody(password, needsCode, code);
			const out = await createServerBackup({ currentPassword: r.currentPassword, code: r.code, include: includeBody(selected) });
			password = '';
			code = '';
			started = true;
			assign(out.url);
		} catch (err) {
			const b = apiErrorBody(err);
			error = backupError(b?.error, errorText(err, t('admin.backup.error')));
			if (b?.error === 'code_invalid') sawCodeInvalid = true;
			const f = reauthFocus(b?.error);
			if (f.clear === 'code') code = '';
			if (f.clear === 'password') password = '';
			busy = false;
			if (f.clear) {
				await tick();
				fields?.focusField(f.focus);
			}
		} finally {
			busy = false;
		}
	}
</script>

<Section title={t('admin.backup.title')}>
	<p>{securityNote()}</p>
	<form onsubmit={create} class="stack">
		<fieldset>
			<legend>{t('admin.backup.include')}</legend>
			{#each PARTS as p (p.id)}
				<label>
					<input type="checkbox" checked={selected.has(p.id)} onchange={(e) => toggle(p.id, e.currentTarget.checked)} />
					{p.label} <span class="hint">{p.hint}</span>
				</label>
			{/each}
		</fieldset>
		<ReauthFields bind:this={fields} bind:password bind:code {needsCode} passwordLabel={t('admin.backup.yourPassword')} />
		<Button type="submit" variant="primary" disabled={!canCreate(selected, password, busy, needsCode, code)}
			>{t('admin.backup.create')}</Button
		>
	</form>
	{#if started}<p role="status">{t('admin.backup.started')}</p>{/if}
	{#if error}<p role="alert">{error}</p>{/if}
	<h3>{t('admin.backup.restore.title')}</h3>
	<p>{t('admin.backup.restore.intro')}</p>
	<ol>{#each restoreSteps() as s (s)}<li>{s}</li>{/each}</ol>
	<p class="hint">
		<Msg key="admin.backup.schedule" args={{ file: '<file>' }}>{#snippet code(text: string)}<code>{text}</code>{/snippet}</Msg>
	</p>
</Section>

<style>
	.stack {
		display: grid;
		gap: var(--space-3);
		max-width: 28rem;
	}

	label {
		display: flex;
		gap: var(--space-2);
		align-items: baseline;
		min-height: var(--hit);
	}

	h3 {
		margin: var(--space-5) 0 var(--space-2);
		font-size: var(--font-size-l);
		font-weight: var(--weight-strong);
	}

	.hint {
		color: var(--readable-muted);
		font-size: var(--font-size-label);
	}
</style>
