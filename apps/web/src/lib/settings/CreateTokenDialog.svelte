<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { errorText } from '$lib/api/apiErrors';
	import { t } from '$lib/i18n';
	import Msg from '$lib/i18n/Msg.svelte';
	import { createToken } from '$lib/api/tokens';
	import { DEFAULT_EXPIRY, EXPIRY_CHOICES, exampleCommand, scopeText, validateTokenForm, type TokenDto } from '$lib/account/tokensView';

	// "New token": the form, then a one-time view of the token. The token
	// lives in this component's state only; closing drops it (it is never
	// put in localStorage, the outbox or a cache).
	let {
		workspaces,
		oncreated,
		onclose
	}: { workspaces: { id: number; name: string }[]; oncreated: (t: TokenDto) => void; onclose: () => void } = $props();

	const uid = $props.id();
	let dialog = $state<HTMLDialogElement | null>(null);
	let nameInput = $state<HTMLInputElement | null>(null);
	let name = $state('');
	let scope = $state<'read' | 'write'>('read');
	let workspace = $state('');
	let days = $state(String(DEFAULT_EXPIRY));
	let password = $state('');
	let busy = $state(false);
	let error = $state('');
	let token = $state('');
	let copied = $state(false);
	let closed = false;

	function finish(): void {
		if (closed) return;
		closed = true;
		token = '';
		password = '';
		if (dialog?.open) {
			if (typeof dialog.close === 'function') dialog.close();
			else dialog.removeAttribute('open');
		}
		onclose();
	}

	async function submit(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (busy) return;
		error = '';
		const form = { name, scope, days: Number(days), password };
		const check = validateTokenForm(form);
		if (!check.ok) {
			error = check.message;
			return;
		}
		busy = true;
		try {
			const out = await createToken({
				name: name.trim(),
				scope,
				workspaceId: workspace === '' ? null : Number(workspace),
				expiresInDays: Number(days),
				currentPassword: password
			});
			password = '';
			token = out.token;
			oncreated(out.accessToken);
		} catch (err) {
			error = errorText(err, t('settings.tokens.create.error'));
			await tick();
			nameInput?.focus();
		} finally {
			busy = false;
		}
	}

	async function copy(): Promise<void> {
		try {
			await navigator.clipboard.writeText(token);
			copied = true;
		} catch {
			error = t('settings.tokens.create.copyFailed');
		}
	}

	onMount(() => {
		if (typeof dialog?.showModal === 'function') dialog.showModal();
		else dialog?.setAttribute('open', '');
		nameInput?.focus();
	});
</script>

<dialog
	bind:this={dialog}
	aria-labelledby="{uid}-title"
	oncancel={(event) => {
		event.preventDefault();
		if (!busy) finish();
	}}
	onclose={finish}
>
	{#if token}
		<div class="stack">
			<h2 id="{uid}-title">{t('settings.tokens.created.title')}</h2>
			<label>
				{t('settings.tokens.created.title')}
				<input class="mono" readonly value={token} onfocus={(e) => (e.currentTarget as HTMLInputElement).select()} />
			</label>
			<p class="warn">
				<Msg key="settings.tokens.created.once">{#snippet strong(text: string)}<strong>{text}</strong>{/snippet}</Msg>
			</p>
			<div class="buttons">
				<button type="button" onclick={copy}>{t('common.action.copy')}</button>
				<span role="status">{copied ? t('common.action.copied') : ''}</span>
			</div>
			{#if error}<p class="error" role="alert">{error}</p>{/if}
			<p>{t('settings.tokens.created.tryIt')}</p>
			<pre class="mono">{exampleCommand(location.origin, token)}</pre>
			<div class="buttons">
				<button type="button" class="primary" onclick={finish}>{t('settings.tokens.created.done')}</button>
			</div>
		</div>
	{:else}
		<form onsubmit={submit} class="stack">
			<h2 id="{uid}-title">{t('settings.tokens.create.title')}</h2>
			<p class="hint">{t('settings.tokens.create.intro')}</p>
			<label>
				{t('settings.tokens.colName')}
				<input bind:this={nameInput} bind:value={name} maxlength="64" autocomplete="off" />
			</label>
			<fieldset>
				<legend>{t('settings.tokens.colAccess')}</legend>
				<label class="check"><input type="radio" name="{uid}-scope" value="read" bind:group={scope} /> {scopeText('read')}</label>
				<label class="check"><input type="radio" name="{uid}-scope" value="write" bind:group={scope} /> {scopeText('write')}</label>
			</fieldset>
			<label>
				{t('settings.tokens.create.workspace')}
				<select bind:value={workspace}>
					<option value="">{t('settings.tokens.allWorkspaces')}</option>
					{#each workspaces as ws (ws.id)}
						<option value={String(ws.id)}>{ws.name.trim() || t('settings.tokens.workspaceN', { id: ws.id })}</option>
					{/each}
				</select>
			</label>
			<label>
				{t('settings.tokens.create.expiresAfter')}
				<select bind:value={days}>
					{#each EXPIRY_CHOICES as d (d)}
						<option value={String(d)}>{t('settings.tokens.create.days', { count: d })}</option>
					{/each}
				</select>
			</label>
			<label>
				{t('account.field.yourPassword')}
				<input type="password" autocomplete="current-password" bind:value={password} />
			</label>
			{#if error}<p class="error" role="alert">{error}</p>{/if}
			<div class="buttons">
				<button type="button" onclick={finish} disabled={busy}>{t('common.action.cancel')}</button>
				<button type="submit" class="primary" disabled={busy}>{busy ? t('settings.tokens.create.creating') : t('settings.tokens.create.submit')}</button>
			</div>
		</form>
	{/if}
</dialog>

<style>
	dialog {
		max-width: min(36rem, calc(100vw - 2rem));
		padding: 1.2rem;
	}
	.stack {
		display: grid;
		gap: 0.8rem;
	}
	label {
		display: grid;
		gap: 0.3rem;
	}
	label.check {
		display: flex;
		gap: 0.5rem;
		align-items: center;
	}
	fieldset {
		border: 0;
		padding: 0;
		margin: 0;
		display: grid;
		gap: 0.3rem;
	}
	input,
	select {
		font: inherit;
		padding: 0.45rem 0.6rem;
	}
	.mono {
		font-family: ui-monospace, monospace;
		word-break: break-all;
		white-space: pre-wrap;
	}
	pre {
		margin: 0;
		padding: 0.6rem;
		border: 1px solid color-mix(in srgb, currentColor 25%, transparent);
		border-radius: 0.4rem;
	}
	.hint {
		margin: 0;
		color: var(--readable-muted);
	}
	.warn,
	.error {
		margin: 0;
	}
	.error {
		color: var(--readable-bad);
		font-weight: 600;
		padding-inline-start: var(--space-2);
		border-inline-start: 3px solid var(--bad);
	}
	.buttons {
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
		align-items: center;
	}
	button {
		font: inherit;
		padding: 0.45rem 0.9rem;
	}
	.primary {
		font-weight: 600;
	}
</style>
