<script lang="ts">
	import { tick } from 'svelte';
	import Button from '$lib/ui/Button.svelte';
	import Dialog from '$lib/ui/Dialog.svelte';
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
	let nameInput = $state<HTMLInputElement | null>(null);
	let passwordInput = $state<HTMLInputElement | null>(null);
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
			await tick();
			(check.field === 'password' ? passwordInput : nameInput)?.focus();
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
			busy = false;
			await tick();
			passwordInput?.focus();
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
</script>

<Dialog
	open
	title={token ? t('settings.tokens.created.title') : t('settings.tokens.create.title')}
	description={token ? undefined : t('settings.tokens.create.intro')}
	initialFocus="input"
	dismissible={!busy}
	onclose={finish}
>
	{#if token}
		<div class="stack">
			<label>
				{t('settings.tokens.created.title')}
				<input class="mono" readonly value={token} onfocus={(e) => (e.currentTarget as HTMLInputElement).select()} />
			</label>
			<p class="warn">
				<Msg key="settings.tokens.created.once">{#snippet strong(text: string)}<strong>{text}</strong>{/snippet}</Msg>
			</p>
			<div class="buttons">
				<Button onclick={copy}>{t('common.action.copy')}</Button>
				<span role="status">{copied ? t('common.action.copied') : ''}</span>
			</div>
			{#if error}<p class="error" role="alert">{error}</p>{/if}
			<p>{t('settings.tokens.created.tryIt')}</p>
			<pre class="mono">{exampleCommand(location.origin, token)}</pre>
		</div>
	{:else}
		<form id="{uid}-form" onsubmit={submit} class="stack">
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
				<input bind:this={passwordInput} type="password" autocomplete="current-password" bind:value={password} />
			</label>
			{#if error}<p class="error" role="alert">{error}</p>{/if}
		</form>
	{/if}
	{#snippet actions()}
		{#if token}
			<Button variant="primary" onclick={finish}>{t('settings.tokens.created.done')}</Button>
		{:else}
			<Button onclick={finish} disabled={busy}>{t('common.action.cancel')}</Button>
			<Button type="submit" form="{uid}-form" variant="primary" {busy}
				>{busy ? t('settings.tokens.create.creating') : t('settings.tokens.create.submit')}</Button
			>
		{/if}
	{/snippet}
</Dialog>

<style>
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
		border: 1px solid var(--hair);
		border-radius: 0.4rem;
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
</style>
