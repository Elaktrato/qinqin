<script lang="ts">
	// Settings → Notifications (#137, #138, #139): the reminders opt-in (off by default), what to remind about,
	// when, quiet hours and the channels (email, web push, device notifications in the Android shell). The value
	// is the person's `reminders` row (lib/reminders/settings.ts), one per account. Changes show at once and
	// save one at a time; a failed save says so and offers Retry. Messages carry counts only, and nothing is
	// sent when nothing is due; the text says both.
	import { onMount } from 'svelte';
	import { t } from '$lib/i18n';
	import { Button, Field, Section } from '$lib/ui';
	import { useSession } from '$lib/context/context';
	import { isShell } from '$lib/native/shell';
	import { api as defaultApi } from '$lib/api/client';
	import { fetchPlan, type ReminderPlan } from '$lib/reminders/plan';
	import { sendReminderTest, type TestChannel } from '$lib/reminders/test';
	import { notifyRemindersChanged } from '$lib/reminders/runtime';
	import { devicePort, type DevicePort, type PermissionState } from '$lib/reminders/device/port';
	import {
		MAX_TIMES,
		REMINDER_KINDS,
		cleanTimes,
		defaultReminderSettings,
		isTime,
		loadReminderRow,
		saveReminderSettings,
		type ReminderChange,
		type ReminderKind,
		type ReminderSettings
	} from '$lib/reminders/settings';
	import {
		browserPushEnv,
		disablePush,
		enablePush,
		listDevices,
		pushSupport,
		removeDevice,
		thisDeviceSubscribed,
		type PushDevice,
		type PushEnv
	} from '$lib/pwa/push';
	import type { MessageKey } from '$lib/i18n';

	const session = useSession();
	const uid = $props.id();

	let {
		load = loadReminderRow,
		save = saveReminderSettings,
		loadPlan = fetchPlan,
		env = browserPushEnv(),
		port = devicePort,
		shell = isShell()
	}: {
		load?: typeof loadReminderRow;
		save?: typeof saveReminderSettings;
		loadPlan?: typeof fetchPlan;
		env?: PushEnv;
		port?: DevicePort;
		shell?: boolean;
	} = $props();

	const KIND_LABELS: Record<ReminderKind, MessageKey> = {
		due: 'settings.reminders.kinds.due',
		goal: 'settings.reminders.kinds.goal',
		streak: 'settings.reminders.kinds.streak'
	};
	const SPARE_TIMES = ['09:00', '12:00', '20:00', '07:00', '15:00'];
	const PUSH_FAILURE: Record<string, MessageKey> = {
		denied: 'settings.reminders.push.denied',
		serverUnavailable: 'apiError.pushUnavailable',
		tooMany: 'apiError.tooManySubscriptions',
		insecure: 'settings.reminders.push.insecure',
		unsupported: 'settings.reminders.push.unsupported',
		iosInstall: 'settings.reminders.push.iosInstall'
	};
	const SUPPORT_TEXT: Record<string, MessageKey> = {
		insecure: 'settings.reminders.push.insecure',
		unsupported: 'settings.reminders.push.unsupported',
		iosInstall: 'settings.reminders.push.iosInstall'
	};

	let settings = $state<ReminderSettings>(defaultReminderSettings());
	let status = $state<'loading' | 'ready' | 'failed'>('loading');
	let newer = $state(false);
	let saveStatus = $state<'idle' | 'saving' | 'saved' | 'error'>('idle');
	let plan = $state.raw<ReminderPlan | null>(null);
	let timeDrafts = $state<string[]>([]);
	let announcement = $state('');

	const user = $derived(session.user);
	const pushDeps = $derived({ api: session.deps.api as typeof defaultApi, env, user });
	const support = $derived(pushSupport(env));
	const readOnly = $derived(status !== 'ready' || newer);

	let devices = $state.raw<PushDevice[]>([]);
	let thisSubscribed = $state(false);
	let pushMessage = $state<MessageKey | ''>('');
	let pushBusy = $state(false);
	let permission = $state<PermissionState>('unsupported');
	let deviceMessage = $state<MessageKey | ''>('');
	let tests = $state<Record<TestChannel, { busy: boolean; text: string; failed: boolean }>>({
		email: { busy: false, text: '', failed: false },
		push: { busy: false, text: '', failed: false }
	});

	onMount(() => {
		void (async () => {
			try {
				const row = await load();
				settings = row.settings;
				newer = row.newer;
				timeDrafts = [...row.settings.times];
				status = 'ready';
			} catch {
				status = 'failed';
				return;
			}
			void refreshPlan();
			void refreshDevices();
			if (shell) permission = await port.permissionStatus().catch(() => 'unsupported' as const);
		})();
	});

	async function refreshPlan(): Promise<void> {
		try {
			plan = await loadPlan(1);
		} catch {
			// Offline or an older server: email and web push read as unavailable.
		}
	}

	async function refreshDevices(): Promise<void> {
		if (!support.ok) return;
		try {
			[devices, thisSubscribed] = await Promise.all([listDevices(pushDeps), thisDeviceSubscribed(pushDeps)]);
		} catch {
			// Leave the list as it was.
		}
	}

	// One save at a time; changes made meanwhile merge and are sent next. A failed one is kept for Retry.
	let pending: ReminderChange = {};
	let unsaved: ReminderChange | null = null;
	let inFlight = false;

	function merge(a: ReminderChange, b: ReminderChange): ReminderChange {
		const out: ReminderChange = { ...a, ...b };
		if (a.kinds || b.kinds) out.kinds = { ...a.kinds, ...b.kinds };
		if (a.channels || b.channels) out.channels = { ...a.channels, ...b.channels };
		return out;
	}

	async function persist(change: ReminderChange): Promise<void> {
		pending = merge(pending, change);
		saveStatus = 'saving';
		if (inFlight) return;
		inFlight = true;
		try {
			while (Object.keys(pending).length > 0) {
				const next = merge(unsaved ?? {}, pending);
				pending = {};
				try {
					await save(next);
					unsaved = null;
				} catch {
					unsaved = next;
				}
			}
		} finally {
			inFlight = false;
		}
		saveStatus = unsaved === null ? 'saved' : 'error';
		if (unsaved === null) notifyRemindersChanged();
	}

	function apply(change: ReminderChange, said = ''): void {
		if (readOnly) return;
		settings = {
			...settings,
			...(change.enabled !== undefined ? { enabled: change.enabled } : {}),
			...(change.times !== undefined ? { times: cleanTimes([...change.times]) } : {}),
			...(change.quiet !== undefined ? { quiet: change.quiet } : {}),
			kinds: { ...settings.kinds, ...change.kinds },
			channels: { ...settings.channels, ...change.channels }
		};
		if (change.times !== undefined) timeDrafts = [...settings.times];
		announcement = said;
		void persist(change);
	}

	function retry(): void {
		if (unsaved !== null) void persist(unsaved);
	}

	// Times: the drafts are what the inputs hold; a valid, distinct set is saved when an input changes.
	function commitTimes(): void {
		const valid = timeDrafts.filter(isTime);
		const unique = [...new Set(valid)].sort();
		if (valid.length === timeDrafts.length && unique.length === valid.length) apply({ times: unique });
	}
	function addTime(): void {
		const spare = SPARE_TIMES.find((time) => !timeDrafts.includes(time)) ?? '10:00';
		timeDrafts = [...timeDrafts, spare];
		commitTimes();
	}
	function removeTime(index: number): void {
		timeDrafts = timeDrafts.filter((_, i) => i !== index);
		commitTimes();
	}

	function setQuiet(part: 'start' | 'end', value: string): void {
		if (settings.quiet === null || !isTime(value)) return;
		const next = { ...settings.quiet, [part]: value };
		// Equal ends would read as no quiet hours; the switch says that.
		if (next.start !== next.end) apply({ quiet: next });
	}

	async function togglePush(on: boolean): Promise<void> {
		pushMessage = '';
		pushBusy = true;
		try {
			if (on) {
				// The click is the gesture the permission prompt needs: nothing is awaited before it.
				const result = await enablePush(pushDeps);
				if (!result.ok) {
					pushMessage = PUSH_FAILURE[result.reason] ?? 'settings.reminders.push.failed';
					return;
				}
				apply({ channels: { push: true } });
			} else {
				await disablePush(pushDeps);
			}
			await refreshDevices();
			if (!on && devices.length === 0) apply({ channels: { push: false } });
		} catch {
			pushMessage = 'settings.reminders.push.failed';
		} finally {
			pushBusy = false;
			permission = env.permission() as PermissionState;
		}
	}

	async function remove(device: PushDevice): Promise<void> {
		pushMessage = '';
		try {
			await removeDevice(pushDeps, device.id);
			announcement = t('settings.reminders.push.removed');
			await refreshDevices();
			if (devices.length === 0 && settings.channels.push) apply({ channels: { push: false } });
		} catch {
			pushMessage = 'settings.reminders.push.removeFailed';
		}
	}

	async function toggleDevice(on: boolean): Promise<void> {
		deviceMessage = '';
		if (!on) {
			apply({ channels: { device: false } });
			return;
		}
		// The click asks the system for the notification permission through the port.
		const state = await port.requestPermission().catch(() => 'unsupported' as const);
		permission = state;
		if (state === 'granted') apply({ channels: { device: true } });
		else deviceMessage = state === 'denied' || state === 'prompt' ? 'settings.reminders.channels.device.denied' : 'settings.reminders.channels.device.unsupported';
	}

	async function test(channel: TestChannel): Promise<void> {
		tests[channel] = { busy: true, text: t('settings.reminders.test.sending'), failed: false };
		const result = await sendReminderTest(channel, session.deps.api as typeof defaultApi);
		tests[channel] = result.ok
			? { busy: false, text: t('settings.reminders.test.sent'), failed: false }
			: { busy: false, text: t(result.messageKey), failed: true };
	}

	const emailAvailable = $derived(plan?.available.email === true);
	const pushAvailable = $derived(plan === null || plan.available.push);
</script>

<h2 id="{uid}-title">{t('settings.reminders.title')}</h2>
<p class="hint">{t('settings.reminders.intro')}</p>

<p class="sr-only" role="status">{announcement}</p>

{#if status === 'loading'}
	<p class="hint" role="status">{t('settings.reminders.loading')}</p>
{:else if status === 'failed'}
	<p class="error" role="alert">{t('settings.reminders.loadFailed')}</p>
{:else}
	{#if newer}<p class="error" role="alert">{t('settings.reminders.newer')}</p>{/if}

	<div class="state" role="status">
		{#if saveStatus === 'saving'}{t('common.state.saving')}{:else if saveStatus === 'saved'}{t('settings.reminders.saved')}{/if}
	</div>
	{#if saveStatus === 'error'}
		<div class="error-row" role="alert">
			<p class="error">{t('settings.reminders.saveFailed')}</p>
			<Button onclick={retry}>{t('common.action.retry')}</Button>
		</div>
	{/if}

	<Section title={t('settings.reminders.enabled.label')} level={3}>
		<label class="switch">
			<input
				type="checkbox"
				role="switch"
				id="{uid}-enabled"
				checked={settings.enabled}
				disabled={readOnly}
				aria-describedby="{uid}-enabled-hint"
				onchange={(event) => apply({ enabled: event.currentTarget.checked })}
			/>
			<span class="track" aria-hidden="true"></span>
			<span>{t('settings.reminders.enabled.label')}</span>
		</label>
		<p class="hint" id="{uid}-enabled-hint">{t('settings.reminders.enabled.hint')}</p>
	</Section>

	<fieldset>
		<legend>{t('settings.reminders.kinds.legend')}</legend>
		{#each REMINDER_KINDS as kind (kind)}
			<label class="switch">
				<input
					type="checkbox"
					role="switch"
					checked={settings.kinds[kind]}
					disabled={readOnly}
					onchange={(event) => apply({ kinds: { [kind]: event.currentTarget.checked } })}
				/>
				<span class="track" aria-hidden="true"></span>
				<span>{t(KIND_LABELS[kind])}</span>
			</label>
		{/each}
	</fieldset>

	<fieldset>
		<legend>{t('settings.reminders.times.legend')}</legend>
		<p class="hint">{t('settings.reminders.times.hint')}</p>
		<ul class="times">
			{#each timeDrafts as _, index (index)}
				<li>
					<Field
						label={t('settings.reminders.times.label', { n: index + 1 })}
						type="time"
						bind:value={timeDrafts[index]}
						disabled={readOnly}
						onchange={commitTimes}
					/>
					{#if timeDrafts.length > 1}
						<Button variant="plain" disabled={readOnly} onclick={() => removeTime(index)}>{t('settings.reminders.times.remove', { n: index + 1 })}</Button>
					{/if}
				</li>
			{/each}
		</ul>
		{#if timeDrafts.length < MAX_TIMES}
			<Button disabled={readOnly} onclick={addTime}>{t('settings.reminders.times.add')}</Button>
		{/if}
	</fieldset>

	<fieldset>
		<legend>{t('settings.reminders.quiet.legend')}</legend>
		<label class="switch">
			<input
				type="checkbox"
				role="switch"
				checked={settings.quiet !== null}
				disabled={readOnly}
				aria-describedby="{uid}-quiet-hint"
				onchange={(event) => apply({ quiet: event.currentTarget.checked ? { start: '22:00', end: '08:00' } : null })}
			/>
			<span class="track" aria-hidden="true"></span>
			<span>{t('settings.reminders.quiet.use')}</span>
		</label>
		<p class="hint" id="{uid}-quiet-hint">{t('settings.reminders.quiet.hint')}</p>
		{#if settings.quiet !== null}
			<div class="quiet">
				<Field label={t('settings.reminders.quiet.start')} type="time" value={settings.quiet.start} disabled={readOnly} onchange={(event) => setQuiet('start', event.currentTarget.value)} />
				<Field label={t('settings.reminders.quiet.end')} type="time" value={settings.quiet.end} disabled={readOnly} onchange={(event) => setQuiet('end', event.currentTarget.value)} />
			</div>
		{/if}
	</fieldset>

	<fieldset>
		<legend>{t('settings.reminders.channels.legend')}</legend>

		<div class="channel">
			<label class="switch">
				<input
					type="checkbox"
					role="switch"
					id="{uid}-email"
					checked={settings.channels.email}
					disabled={readOnly || (!emailAvailable && !settings.channels.email)}
					aria-describedby="{uid}-email-hint"
					onchange={(event) => apply({ channels: { email: event.currentTarget.checked } })}
				/>
				<span class="track" aria-hidden="true"></span>
				<span>{t('settings.reminders.channels.email.label')}</span>
			</label>
			<p class="hint" id="{uid}-email-hint">
				{emailAvailable ? t('settings.reminders.channels.email.hint') : t('settings.reminders.channels.email.unavailable')}
			</p>
			{#if settings.channels.email && emailAvailable}
				<Button disabled={tests.email.busy} aria-describedby="{uid}-email-test" onclick={() => test('email')}>{t('settings.reminders.test.button')}</Button>
			{/if}
			<p id="{uid}-email-test" class:error={tests.email.failed} role="status">{tests.email.text}</p>
		</div>

		{#if !shell}
			<div class="channel">
				{#if support.ok}
					<label class="switch">
						<input
							type="checkbox"
							role="switch"
							id="{uid}-push"
							checked={thisSubscribed}
							disabled={readOnly || pushBusy || (!pushAvailable && !thisSubscribed)}
							aria-describedby="{uid}-push-hint"
							onchange={(event) => void togglePush(event.currentTarget.checked)}
						/>
						<span class="track" aria-hidden="true"></span>
						<span>{t('settings.reminders.channels.push.label')}</span>
					</label>
					<p class="hint" id="{uid}-push-hint">
						{pushAvailable ? t('settings.reminders.channels.push.hint') : t('settings.reminders.channels.push.serverUnavailable')}
					</p>
				{:else}
					<p><strong>{t('settings.reminders.channels.push.label')}</strong></p>
					<p class="hint" id="{uid}-push-hint">{t(SUPPORT_TEXT[support.reason] ?? 'settings.reminders.push.unsupported')}</p>
				{/if}
				{#if pushMessage !== ''}<p class="error" role="alert">{t(pushMessage)}</p>{/if}
				{#if support.ok && permission === 'denied' && !thisSubscribed}<p class="hint">{t('settings.reminders.push.denied')}</p>{/if}
				{#if settings.channels.push && devices.length > 0 && pushAvailable}
					<Button disabled={tests.push.busy} aria-describedby="{uid}-push-test" onclick={() => test('push')}>{t('settings.reminders.test.button')}</Button>
				{/if}
				<p id="{uid}-push-test" class:error={tests.push.failed} role="status">{tests.push.text}</p>

				{#if support.ok}
					<h3 id="{uid}-devices">{t('settings.reminders.push.devices')}</h3>
					{#if devices.length === 0}
						<p class="hint">{t('settings.reminders.push.noDevices')}</p>
					{:else}
						<ul class="devices" aria-labelledby="{uid}-devices">
							{#each devices as device (device.id)}
								<li>
									<span>{device.label}{#if device.current} <em>({t('settings.reminders.push.thisDevice')})</em>{/if}</span>
									<Button variant="plain" aria-label={t('settings.reminders.push.removeLabel', { label: device.label })} onclick={() => remove(device)}>{t('settings.reminders.push.remove')}</Button>
								</li>
							{/each}
						</ul>
					{/if}
				{/if}
			</div>
		{/if}

		{#if shell}
			<div class="channel">
				<label class="switch">
					<input
						type="checkbox"
						role="switch"
						id="{uid}-device"
						checked={settings.channels.device}
						disabled={readOnly}
						aria-describedby="{uid}-device-hint"
						onchange={(event) => void toggleDevice(event.currentTarget.checked)}
					/>
					<span class="track" aria-hidden="true"></span>
					<span>{t('settings.reminders.channels.device.label')}</span>
				</label>
				<p class="hint" id="{uid}-device-hint">{t('settings.reminders.channels.device.hint')}</p>
				{#if deviceMessage !== ''}<p class="error" role="alert">{t(deviceMessage)}</p>{/if}
			</div>
		{/if}
	</fieldset>
{/if}

<style>
	h2 {
		margin-top: var(--space-6);
	}
	h3 {
		font-size: var(--font-size-label);
		font-weight: var(--weight-regular);
		color: var(--readable-muted);
		margin: var(--space-3) 0 var(--space-1);
	}
	.hint {
		color: var(--readable-muted);
	}
	.error {
		color: var(--readable-bad);
		font-weight: var(--weight-medium);
	}
	.error-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
	}
	.state {
		min-height: 1.5rem;
		color: var(--readable-muted);
	}
	fieldset {
		margin: var(--space-4) 0 0;
		padding: var(--space-3) 0 0;
		border: 0;
		border-top: 1px solid var(--hair);
		display: grid;
		gap: var(--space-2);
	}
	legend {
		padding: 0;
		font-size: var(--font-size-label);
		color: var(--readable-muted);
	}
	.times,
	.devices {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: var(--space-2);
	}
	.times li,
	.devices li {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		gap: var(--space-2) var(--space-3);
	}
	.devices li {
		align-items: center;
		justify-content: space-between;
	}
	.quiet {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
	}
	.channel {
		display: grid;
		gap: var(--space-1);
		padding-block: var(--space-2);
	}
	.channel + .channel {
		border-top: 1px solid var(--hair);
	}
	.switch {
		position: relative;
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		min-height: var(--hit);
		cursor: pointer;
	}
	.switch input {
		position: absolute;
		top: 50%;
		left: 0;
		transform: translateY(-50%);
		width: 2.5rem;
		height: 1.4rem;
		margin: 0;
		opacity: 0;
		cursor: pointer;
	}
	.track {
		position: relative;
		flex: none;
		width: 2.5rem;
		height: 1.4rem;
		border-radius: 999px;
		background: var(--line);
		transition: background var(--motion-fast) var(--ease-standard);
	}
	.track::after {
		content: '';
		position: absolute;
		top: 0.15rem;
		left: 0.15rem;
		width: 1.1rem;
		height: 1.1rem;
		border-radius: 50%;
		background: var(--panel);
		transition: transform var(--motion-fast) var(--ease-standard);
	}
	.switch input:checked + .track {
		background: var(--accent);
	}
	.switch input:checked + .track::after {
		transform: translateX(1.1rem);
	}
	.switch input:disabled + .track {
		opacity: 0.5;
	}
	.switch input:focus-visible + .track {
		outline: var(--focus-ring);
		outline-offset: var(--focus-ring-offset);
	}
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		margin: -1px;
		padding: 0;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
		border: 0;
	}
</style>
