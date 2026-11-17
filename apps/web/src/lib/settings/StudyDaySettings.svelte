<script lang="ts">
	import { onMount } from 'svelte';
	import { t } from '$lib/i18n';
	import Msg from '$lib/i18n/Msg.svelte';
	import { unusableZones } from '$lib/time/studyDay';
	import {
		browserZone,
		changeZone,
		currentHistory,
		currentStudyDay,
		onStudyDayChange
	} from '$lib/time/zone';
	import { changeErrorMessage, mismatch, zoneLabel, zoneMatchText, zoneOptions } from './zoneSettings';

	let day = $state(currentStudyDay());
	let history = $state([...currentHistory()]);
	let query = $state('');
	let picked = $state('');
	let busy = $state(false);
	let error = $state('');

	onMount(() => onStudyDayChange((next) => {
		day = next;
		history = [...currentHistory()];
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
			await changeZone(zone);
		} catch (err) {
			error = changeErrorMessage(err);
		} finally {
			busy = false;
		}
	}
</script>

<section class="study-day">
	<h2>{t('settings.studyDay.title')}</h2>
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
			<button type="button" disabled={busy} onclick={() => apply(device)}
				>{t('settings.studyDay.useDevice', { zone: device })}</button
			>
		</div>
	{/if}

	<div class="picker">
		<label>
			<span>{t('settings.studyDay.search')}</span>
			<input type="search" bind:value={query} autocomplete="off" />
		</label>
		<label>
			<span>{t('settings.studyDay.zone')}</span>
			<select value={selected} onchange={(e) => (picked = e.currentTarget.value)}>
				{#each options as zone (zone)}
					<option value={zone}>{zone}</option>
				{/each}
			</select>
		</label>
		<button type="button" disabled={busy || selected === current} onclick={() => apply(selected)}
			>{t('settings.studyDay.change')}</button
		>
	</div>

	<p class="sr-only" aria-live="polite">{matchText}</p>

	{#if error}
		<p class="error" role="alert">{error}</p>
	{/if}
</section>

<style>
	.picker {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		align-items: end;
		margin-block: 1rem;
	}
	.picker label {
		display: grid;
		gap: 0.25rem;
	}
	.notice {
		margin-block: 0.75rem;
		padding: 0.75rem 1rem;
		border: 1px solid var(--border, currentColor);
		border-radius: 0.5rem;
	}
	.warning,
	.error {
		margin-block: 0.5rem;
	}
</style>
