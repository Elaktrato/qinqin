<script lang="ts">
	import { onMount } from 'svelte';
	import { t } from '$lib/i18n';
	import Msg from '$lib/ui/Msg.svelte';
	import { unusableZones } from '$lib/time/studyDay';
	import { browserZone } from '$lib/time/zone';
	import { changeErrorMessage, mismatch, zoneLabel, zoneMatchText, zoneOptions } from './zoneSettings';
	import { Button, Field, Section, Select } from '$lib/ui';
	import { useSession } from '$lib/context/context';
	const session = useSession();

	let day = $state(session.zone.day());
	let history = $state([...session.zone.known()]);
	let query = $state('');
	let picked = $state('');
	let busy = $state(false);
	let error = $state('');

	onMount(() => session.zone.onChange((next) => {
		day = next;
		history = [...session.zone.known()];
		picked = '';
	}));

	const supported: readonly string[] | undefined =
		typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : undefined;
	const now = Date.now();

	const current = $derived(day.zone);
	const unusable = $derived(unusableZones(history));
	const device = $derived(mismatch(current, browserZone()));
	const options = $derived(zoneOptions(supported, current, query));
	// The live count follows the query once typing pauses, so a screen
	// reader hears one count instead of one per keystroke.
	const ANNOUNCE_DELAY_MS = 500;
	let announcedQuery = $state('');
	$effect(() => {
		const next = query;
		const timer = setTimeout(() => (announcedQuery = next), ANNOUNCE_DELAY_MS);
		return () => clearTimeout(timer);
	});
	const matchText = $derived(zoneMatchText(supported, announcedQuery));
	const selected = $derived(picked !== '' && options.includes(picked) ? picked : current);

	async function apply(zone: string): Promise<void> {
		busy = true;
		error = '';
		try {
			await session.zone.change(zone);
		} catch (err) {
			error = changeErrorMessage(err);
		} finally {
			busy = false;
		}
	}
</script>

<Section title={t('settings.studyDay.title')}>
	<p class="hint">{t('settings.studyDay.hint')}</p>
	<p class="current">
		<Msg key="settings.studyDay.current" args={{ zone: zoneLabel(current, now) }}
			>{#snippet strong(text: string)}<strong>{text}</strong>{/snippet}</Msg
		>
	</p>
	<p class="hint">{t('settings.studyDay.fromNow')}</p>

	{#if unusable.length > 0}
		<p class="warning" role="alert">
			{t('settings.studyDay.unusable', { zones: unusable.join(', ') })}
		</p>
	{/if}

	{#if device}
		<div class="notice">
			<p>{t('settings.studyDay.device', { zone: device })}</p>
			<Button disabled={busy} onclick={() => apply(device)}
				>{t('settings.studyDay.useDevice', { zone: device })}</Button
			>
		</div>
	{/if}

	<div class="picker">
		<div class="search">
			<Field label={t('settings.studyDay.search')} type="search" bind:value={query} autocomplete="off" />
		</div>
		<div class="zone">
			<Select
				label={t('settings.studyDay.zone')}
				value={selected}
				options={options.map((zone) => ({ value: zone, label: zone }))}
				onchange={(e) => (picked = e.currentTarget.value)}
			/>
		</div>
		<Button variant="primary" disabled={busy || selected === current} onclick={() => apply(selected)}
			>{t('settings.studyDay.change')}</Button
		>
	</div>

	<p class="sr-only" aria-live="polite">{matchText}</p>

	{#if error}
		<p class="error" role="alert">{error}</p>
	{/if}
</Section>

<style>
	.picker {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
		align-items: end;
		margin-block: var(--space-4);
	}

	.search {
		flex: 1 1 12rem;
	}

	.zone {
		flex: 1 1 14rem;
	}

	.notice {
		margin-block: var(--space-3);
		padding-inline-start: var(--space-3);
		border-inline-start: 1px solid var(--hair);
	}

	.warning,
	.error {
		margin-block: var(--space-2);
	}

	.error {
		color: var(--readable-bad);
		padding-inline-start: var(--space-2);
		border-inline-start: 3px solid var(--bad);
	}
</style>
