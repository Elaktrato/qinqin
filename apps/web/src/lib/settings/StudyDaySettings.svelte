<script lang="ts">
	import { onMount } from 'svelte';
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
	const matchText = $derived(zoneMatchText(supported, query));
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
	<h2>Study day</h2>
	<p class="hint">
		Your study day starts at midnight in your time zone. Heatmap, streaks, daily goals and limits all
		count days this way, on every device.
	</p>
	<p class="current">Time zone: <strong>{zoneLabel(current, now)}</strong></p>
	<p class="hint">Changes apply from now on; past days stay as they were.</p>

	{#if unusable.length > 0}
		<p class="warning" role="alert">
			This browser does not know the time zone {unusable.join(', ')}; days in that period are
			counted in UTC here.
		</p>
	{/if}

	{#if device}
		<div class="notice">
			<p>This device is set to {device}.</p>
			<button type="button" disabled={busy} onclick={() => apply(device)}
				>Use {device} from now on</button
			>
		</div>
	{/if}

	<div class="picker">
		<label>
			<span>Search time zones</span>
			<input type="search" bind:value={query} autocomplete="off" />
		</label>
		<label>
			<span>Time zone</span>
			<select value={selected} onchange={(e) => (picked = e.currentTarget.value)}>
				{#each options as zone (zone)}
					<option value={zone}>{zone}</option>
				{/each}
			</select>
		</label>
		<button type="button" disabled={busy || selected === current} onclick={() => apply(selected)}
			>Change time zone</button
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
