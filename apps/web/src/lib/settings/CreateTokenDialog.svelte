<script lang="ts">
	import { tick } from 'svelte';
	import Button from '$lib/ui/Button.svelte';
	import Dialog from '$lib/ui/Dialog.svelte';
	import Field from '$lib/ui/Field.svelte';
	import IconButton from '$lib/ui/IconButton.svelte';
	import Panel from '$lib/ui/Panel.svelte';
	import Select from '$lib/ui/Select.svelte';
	import { errorText } from '$lib/api/apiErrors';
	import { t } from '$lib/i18n';
	import Msg from '$lib/ui/Msg.svelte';
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
	let nameInput = $state<HTMLInputElement | undefined>(undefined);
	let passwordInput = $state<HTMLInputElement | undefined>(undefined);
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
			<Panel raised class="token-panel">
				<Field
					label={t('settings.tokens.created.title')}
					readonly
					value={token}
					onfocus={(e) => (e.currentTarget as HTMLInputElement).select()}
				/>
				<div class="buttons">
					<IconButton icon="copy" label={t('common.action.copy')} onclick={copy} />
					<span role="status">{copied ? t('common.action.copied') : ''}</span>
				</div>
			</Panel>
			<p class="warn">
				<Msg key="settings.tokens.created.once">{#snippet strong(text: string)}<strong>{text}</strong>{/snippet}</Msg>
			</p>
			{#if error}<p class="error" role="alert">{error}</p>{/if}
			<p>{t('settings.tokens.created.tryIt')}</p>
			<pre class="mono">{exampleCommand(location.origin, token)}</pre>
		</div>
	{:else}
		<form id="{uid}-form" onsubmit={submit} class="stack">
			<Field
				label={t('settings.tokens.colName')}
				bind:element={nameInput}
				bind:value={name}
				maxlength={64}
				autocomplete="off"
			/>
			<fieldset>
				<legend>{t('settings.tokens.colAccess')}</legend>
				<label class="check"><input type="radio" name="{uid}-scope" value="read" bind:group={scope} /> {scopeText('read')}</label>
				<label class="check"><input type="radio" name="{uid}-scope" value="write" bind:group={scope} /> {scopeText('write')}</label>
			</fieldset>
			<Select
				label={t('settings.tokens.create.workspace')}
				bind:value={workspace}
				options={[
					{ value: '', label: t('settings.tokens.allWorkspaces') },
					...workspaces.map((ws) => ({
						value: String(ws.id),
						label: ws.name.trim() || t('settings.tokens.workspaceN', { id: ws.id })
					}))
				]}
			/>
			<Select
				label={t('settings.tokens.create.expiresAfter')}
				bind:value={days}
				options={EXPIRY_CHOICES.map((d) => ({
					value: String(d),
					label: t('settings.tokens.create.days', { count: d })
				}))}
			/>
			<Field
				label={t('account.field.yourPassword')}
				type="password"
				autocomplete="current-password"
				bind:element={passwordInput}
				bind:value={password}
			/>
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
		gap: var(--space-3);
	}

	label.check {
		display: flex;
		gap: var(--space-2);
		align-items: center;
		min-height: var(--hit);
	}

	fieldset {
		display: grid;
		gap: var(--space-1);
	}

	.mono {
		font-family: ui-monospace, monospace;
		word-break: break-all;
		white-space: pre-wrap;
	}

	pre {
		margin: 0;
		padding: var(--space-2);
		border: 1px solid var(--hair);
		border-radius: var(--radius);
	}

	.warn,
	.error {
		margin: 0;
	}

	.error {
		color: var(--readable-bad);
		padding-inline-start: var(--space-2);
		border-inline-start: 3px solid var(--bad);
	}

	.buttons {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		align-items: center;
	}
</style>
