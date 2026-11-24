<script lang="ts">
	import { onMount } from 'svelte';
	import { errorText } from '$lib/api/apiErrors';
	import { t } from '$lib/i18n';
	import { listTokens, revokeAllTokens, revokeToken } from '$lib/api/tokens';
	import { tokenRows, type TokenDto } from '$lib/account/tokensView';
	import CreateTokenDialog from './CreateTokenDialog.svelte';
	import { Button, Section } from '$lib/ui';
	import { useSession } from '$lib/context/context';
	const session = useSession();

	// Settings → Account → Access tokens: the list, revoke (one or all, each
	// confirmed) and "New token". oncount tells the page how many exist, for
	// the "your access tokens are revoked too" notes.
	let { oncount }: { oncount?: (n: number) => void } = $props();

	let tokens = $state<TokenDto[]>([]);
	let loaded = $state(false);
	let error = $state('');
	let busy = $state(false);
	let creating = $state(false);
	let confirmOne = $state<number | null>(null);
	let confirmAll = $state(false);

	const wsList = $derived(session.workspaces.list.map((w) => ({ id: w.id, name: w.name ?? '' })));
	const rows = $derived(tokenRows(tokens, wsList, new Date()));

	function set(list: TokenDto[]): void {
		tokens = list;
		oncount?.(list.length);
	}

	async function load(): Promise<void> {
		try {
			set(await listTokens());
			error = '';
		} catch (err) {
			error = errorText(err, t('settings.tokens.error.load'));
		} finally {
			loaded = true;
		}
	}

	async function revokeOne(id: number): Promise<void> {
		if (busy) return;
		busy = true;
		try {
			await revokeToken(id);
			confirmOne = null;
			await load();
		} catch (err) {
			error = errorText(err, t('settings.tokens.error.revoke'));
		} finally {
			busy = false;
		}
	}

	async function revokeEvery(): Promise<void> {
		if (busy) return;
		busy = true;
		try {
			await revokeAllTokens();
			confirmAll = false;
			await load();
		} catch (err) {
			error = errorText(err, t('settings.tokens.error.revokeAll'));
		} finally {
			busy = false;
		}
	}

	onMount(() => void load());
</script>

<Section title={t('settings.tokens.title')}>
	<p class="hint">{t('settings.tokens.intro')}</p>
	{#if error}<p class="error" role="alert">{error}</p>{/if}
	{#if loaded && rows.length === 0 && !error}
		<p>{t('settings.tokens.none')}</p>
	{:else if rows.length > 0}
		<table class="ui-table" aria-label={t('settings.tokens.title')}>
			<thead>
				<tr>
					<th scope="col">{t('settings.tokens.colName')}</th>
					<th scope="col">{t('settings.tokens.colAccess')}</th>
					<th scope="col">{t('settings.tokens.colExpiry')}</th>
					<th scope="col">{t('settings.tokens.colLastUsed')}</th>
					<th scope="col"><span class="visually-hidden">{t('settings.tokens.colActions')}</span></th>
				</tr>
			</thead>
			<tbody>
				{#each rows as row (row.id)}
					<tr>
						<th scope="row">{row.name}<br /><code>{row.masked}</code></th>
						<td>{row.scopeLabel}<br />{row.workspaceLabel}</td>
						<td>{row.expiryText}</td>
						<td>{row.lastUsedText}</td>
						<td>
							<Button disabled={busy} aria-label={t('settings.tokens.revokeNamed', { name: row.name })} onclick={() => (confirmOne = row.id)}
								>{t('settings.tokens.revoke')}</Button
							>
							{#if confirmOne === row.id}
								<div class="confirm" role="group" aria-label={t('settings.tokens.confirmRevokeNamed', { name: row.name })}>
									<p>{t('settings.tokens.confirmRevokeText', { name: row.name })}</p>
									<Button tone="danger" disabled={busy} onclick={() => revokeOne(row.id)}>{t('settings.tokens.confirmRevokeYes')}</Button>
									<Button disabled={busy} onclick={() => (confirmOne = null)}>{t('common.action.cancel')}</Button>
								</div>
							{/if}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
	<div class="actions">
		<Button disabled={busy} onclick={() => (creating = true)}>{t('settings.tokens.new')}</Button>
		{#if rows.length > 0}
			<Button tone="danger" disabled={busy} onclick={() => (confirmAll = true)}>{t('settings.tokens.revokeAll')}</Button>
		{/if}
	</div>
	{#if confirmAll}
		<div class="confirm" role="group" aria-label={t('settings.tokens.confirmRevokeAll')}>
			<p>{t('settings.tokens.confirmRevokeAllText')}</p>
			<Button tone="danger" disabled={busy} onclick={revokeEvery}>{t('settings.tokens.confirmRevokeAllYes')}</Button>
			<Button disabled={busy} onclick={() => (confirmAll = false)}>{t('common.action.cancel')}</Button>
		</div>
	{/if}
</Section>

{#if creating}
	<CreateTokenDialog
		workspaces={wsList}
		oncreated={(tok) => set([tok, ...tokens])}
		onclose={() => {
			creating = false;
			void load();
		}}
	/>
{/if}

<style>
	.hint {
		margin: 0;
		color: var(--readable-muted);
	}

	.error {
		margin: 0;
		color: var(--readable-bad);
		padding-inline-start: var(--space-2);
		border-inline-start: 3px solid var(--bad);
	}

	code {
		font-size: var(--font-size-label);
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin-top: var(--space-2);
	}

	.confirm {
		margin-top: var(--space-2);
		padding-top: var(--space-2);
		border-top: 1px solid var(--hair);
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		align-items: center;
	}

	.confirm p {
		flex-basis: 100%;
		margin: 0;
	}
</style>
