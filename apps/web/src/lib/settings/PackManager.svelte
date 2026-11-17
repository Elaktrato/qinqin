<script lang="ts">
	import { onDestroy, onMount, tick } from 'svelte';
	import { ApiError } from '$lib/api/client';
	import {
		discardStaged,
		installStaged,
		listPacks,
		stagePack,
		uninstallPack,
		waitForImport,
		type InstalledPack,
		type StagedPack
	} from '$lib/api/packs';
	import { getCatalogue, type Catalogue } from '$lib/api/packages';
	import type { UploadProgress } from '$lib/api/upload';
	import { languageLabel } from '$lib/languages';
	import {
		LICENCE_CONFIRMATION,
		LICENCE_LABEL,
		PACKAGES_BUILDING,
		PACKAGES_UNAVAILABLE,
		groupPacks,
		licenceCaution,
		licenceLine,
		packageLine,
		packagesOf,
		progressText,
		replaceLines,
		uninstallWarning
	} from './packsView';

	type Phase = 'idle' | 'uploading' | 'review' | 'importing';

	let packs = $state<InstalledPack[]>([]);
	let loading = $state(true);
	let loadError = $state('');

	// What the server has built from the installed packs (GET /api/packages); null until read.
	let catalogue = $state<Catalogue | null>(null);
	let catalogueFailed = $state(false);

	async function loadCatalogue(): Promise<void> {
		try {
			catalogue = await getCatalogue();
			catalogueFailed = false;
		} catch {
			catalogue = null;
			catalogueFailed = true;
		}
	}

	let phase = $state<Phase>('idle');
	let fileInput = $state<HTMLInputElement>();
	let file = $state<File | null>(null);
	let progress = $state<UploadProgress>({ loaded: 0, total: 0 });
	let staged = $state<StagedPack | null>(null);
	let confirmed = $state(false);
	let notice = $state('');
	// Called after an install or uninstall changed the installed packs.
	let { onchange }: { onchange?: () => void } = $props();

	let error = $state('');
	let upload: AbortController | null = null;
	let poll: AbortController | null = null;

	let pending = $state<InstalledPack | null>(null);
	let uninstalling = $state(false);
	let dialog = $state<HTMLDialogElement>();
	let listHeading = $state<HTMLHeadingElement>();

	const groups = $derived(groupPacks(packs));
	const checking = $derived(phase === 'uploading' && progress.total > 0 && progress.loaded >= progress.total);
	const caution = $derived(staged ? licenceCaution(staged.manifest.license) : null);
	const replaces = $derived(staged ? replaceLines(staged) : []);

	function message(err: unknown, fallback: string): string {
		return err instanceof ApiError ? err.message : fallback;
	}

	async function load(): Promise<void> {
		loading = true;
		loadError = '';
		try {
			packs = await listPacks();
			void loadCatalogue();
		} catch (err) {
			packs = [];
			loadError = message(err, 'Could not load the installed packs.');
		} finally {
			loading = false;
		}
	}

	onMount(load);

	// A pack staged but never installed is dropped when the page goes
	// away (best effort; the server also expires it after 30 minutes).
	onDestroy(() => {
		upload?.abort();
		poll?.abort();
		if (staged && phase === 'review') void discardStaged(staged.token).catch(() => {});
	});

	function pick(event: Event): void {
		file = (event.currentTarget as HTMLInputElement).files?.[0] ?? null;
		error = '';
		notice = '';
	}

	async function startUpload(): Promise<void> {
		if (!file || phase !== 'idle') return;
		error = '';
		notice = '';
		progress = { loaded: 0, total: 0 };
		upload = new AbortController();
		phase = 'uploading';
		try {
			staged = await stagePack(file, { onProgress: (p) => (progress = p), signal: upload.signal });
			confirmed = false;
			phase = 'review';
		} catch (err) {
			phase = 'idle';
			if (err instanceof DOMException && err.name === 'AbortError') notice = 'Upload cancelled.';
			else error = message(err, 'The upload failed.');
		} finally {
			upload = null;
		}
	}

	function cancelUpload(): void {
		upload?.abort();
	}

	function resetForm(): void {
		staged = null;
		confirmed = false;
		file = null;
		if (fileInput) fileInput.value = '';
		phase = 'idle';
	}

	async function discard(): Promise<void> {
		if (!staged) return;
		const token = staged.token;
		resetForm();
		try {
			await discardStaged(token);
			notice = 'Discarded. Nothing was installed.';
		} catch (err) {
			error = message(err, 'Could not discard the staged pack.');
		}
	}

	async function install(): Promise<void> {
		if (!staged || !confirmed || phase !== 'review') return;
		const { token, manifest } = staged;
		error = '';
		notice = '';
		try {
			// The licence echoed here is the one shown in the review card.
			await installStaged(token, manifest.license);
		} catch (err) {
			error = message(err, 'Could not start the import.');
			return;
		}
		phase = 'importing';
		poll = new AbortController();
		try {
			const result = await waitForImport(token, { signal: poll.signal });
			if (result.status === 'done') {
				notice = `Installed ${manifest.name}: ${result.summary ?? 'done'}.`;
				if (result.warning) error = result.warning;
				await load();
				onchange?.();
			} else {
				error = result.error ?? 'The import failed.';
			}
			resetForm();
		} catch (err) {
			if (!(err instanceof DOMException && err.name === 'AbortError')) {
				error = message(err, 'Lost contact with the server; the import may still finish. Check the list below.');
				resetForm();
			}
		} finally {
			poll = null;
		}
	}

	async function askUninstall(pack: InstalledPack): Promise<void> {
		pending = pack;
		await tick();
		dialog?.showModal();
	}

	function closeDialog(): void {
		dialog?.close();
		pending = null;
	}

	async function confirmUninstall(): Promise<void> {
		if (!pending) return;
		const pack = pending;
		uninstalling = true;
		error = '';
		notice = '';
		try {
			await uninstallPack(pack.type, pack.packId);
			notice = `Uninstalled ${pack.name || pack.packId}.`;
			await load();
			onchange?.();
		} catch (err) {
			error = message(err, 'Could not uninstall the pack.');
		} finally {
			uninstalling = false;
			closeDialog();
			// The uninstalled row's button is gone: keep keyboard focus on the list.
			await tick();
			listHeading?.focus();
		}
	}

	function fmtDate(iso: string): string {
		const d = new Date(iso);
		return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
	}
</script>

<section class="packs" aria-labelledby="packs-heading">
	<h2 id="packs-heading" tabindex="-1" bind:this={listHeading}>Packs</h2>
	<p class="hint">
		Dictionaries, frequency lists, level lists, sentences and grammar lessons installed on this
		server. Licences are shown as each pack states them; qinqin does not check them.
	</p>

	<form class="install" onsubmit={(event) => { event.preventDefault(); void startUpload(); }}>
		<label class="file">
			<span>Pack zip</span>
			<input
				bind:this={fileInput}
				type="file"
				accept=".zip,application/zip"
				onchange={pick}
				disabled={phase !== 'idle'}
			/>
		</label>
		<button type="submit" disabled={!file || phase !== 'idle'}>Upload</button>
	</form>

	{#if phase === 'uploading'}
		<div class="progress" role="status">
			{#if checking}
				<p>Uploaded, checking the pack…</p>
				<progress aria-label="Checking the pack"></progress>
			{:else}
				<p>Uploading… {progressText(progress)}</p>
				<progress max={progress.total || 1} value={progress.loaded} aria-label="Upload progress"></progress>
			{/if}
			<button type="button" onclick={cancelUpload}>Cancel</button>
		</div>
	{/if}

	{#if staged && (phase === 'review' || phase === 'importing')}
		<div class="review" role="region" aria-labelledby="review-heading">
			<h3 id="review-heading">Review before installing</h3>
			<p class="hint">This is what the server read from the pack. Nothing is installed yet.</p>
			<dl>
				<dt>Name</dt>
				<dd>{staged.manifest.name}</dd>
				<dt>Pack id</dt>
				<dd><code>{staged.manifest.id}</code></dd>
				<dt>Version</dt>
				<dd>{staged.manifest.version}</dd>
				<dt>Type</dt>
				<dd>{staged.manifest.type}</dd>
				<dt>Language</dt>
				<dd>{languageLabel(staged.manifest.language)}</dd>
				<dt>{LICENCE_LABEL}</dt>
				<dd class="licence">{staged.manifest.license}</dd>
				<dt>Attribution</dt>
				<dd>{staged.manifest.attribution}</dd>
				{#if staged.manifest.notice}
					<dt>Notice</dt>
					<dd class="notice-text">{staged.manifest.notice}</dd>
				{/if}
			</dl>
			{#if caution}
				<p class="caution" role="note">{caution}</p>
			{/if}
			{#if replaces.length > 0}
				<ul class="replaces">
					{#each replaces as line (line.text)}
						<li class:changed={line.licenceChanged}>{line.text}</li>
					{/each}
				</ul>
			{/if}
			<label class="confirm">
				<input type="checkbox" bind:checked={confirmed} disabled={phase !== 'review'} />
				<span>{LICENCE_CONFIRMATION}</span>
			</label>
			<div class="actions">
				<button type="button" onclick={install} disabled={!confirmed || phase !== 'review'}>Install</button>
				<button type="button" onclick={discard} disabled={phase !== 'review'}>Discard</button>
			</div>
			{#if phase === 'importing'}
				<div class="progress" role="status">
					<p>Importing… large dictionaries can take a minute</p>
					<progress aria-label="Importing"></progress>
				</div>
			{/if}
		</div>
	{/if}

	{#if notice}
		<p class="notice" role="status">{notice}</p>
	{/if}
	{#if error}
		<p class="error" role="alert">{error}</p>
	{/if}

	{#if catalogue?.building}
		<p class="notice" role="status">{PACKAGES_BUILDING}</p>
	{:else if catalogueFailed}
		<p class="hint">{PACKAGES_UNAVAILABLE}</p>
	{/if}

	{#if loading}
		<p>Loading installed packs…</p>
	{:else if loadError}
		<p class="error" role="alert">{loadError}</p>
		<button type="button" onclick={load}>Retry</button>
	{:else if packs.length === 0}
		<p>No packs are installed. Upload a pack zip above, or run <code>qinqin seed</code>.</p>
	{:else}
		{#each groups as group (group.type)}
			<h3>{group.label}</h3>
			<ul class="pack-list">
				{#each group.packs as pack (pack.packId)}
					{@const lic = licenceLine(pack.license)}
					<li>
						<div class="pack-head">
							<strong>{pack.name || pack.packId}</strong>
							<code>{pack.packId}</code>
							{#if pack.language}<span>{languageLabel(pack.language)}</span>{/if}
							{#if pack.version}<span>{pack.version}</span>{/if}
							{#if pack.updatedAt}<span>{fmtDate(pack.updatedAt)}</span>{/if}
						</div>
						<p class:unrecorded={!lic.recorded}>
							{#if lic.recorded}<span class="label">{LICENCE_LABEL}:</span> {/if}{lic.text}
						</p>
						{#if pack.attribution}
							<p><span class="label">Attribution:</span> {pack.attribution}</p>
						{/if}
						{#each packagesOf(pack, catalogue?.packages ?? []) as row (row.id)}
							{@const line = packageLine(row)}
							<p class="package"><span class="label">Package</span> {line.text}</p>
							{#if line.error}<p class="error package-error">Last build failed: {line.error}</p>{/if}
						{/each}
						<button type="button" class="uninstall" onclick={() => askUninstall(pack)}>
							Uninstall<span class="sr"> {pack.name || pack.packId}</span>
						</button>
					</li>
				{/each}
			</ul>
		{/each}
	{/if}

	<p><a href="/sources">See all credits on the Sources page</a></p>

	<dialog bind:this={dialog} aria-labelledby="uninstall-heading" onclose={() => (pending = null)}>
		{#if pending}
			<h3 id="uninstall-heading">Uninstall {pending.name || pending.packId}?</h3>
			<p>{uninstallWarning(pending.type)}</p>
			<div class="actions">
				<button type="button" onclick={confirmUninstall} disabled={uninstalling}>
					{uninstalling ? 'Uninstalling…' : 'Uninstall'}
				</button>
				<button type="button" onclick={closeDialog} disabled={uninstalling}>Cancel</button>
			</div>
		{/if}
	</dialog>
</section>

<style>
	.packs button,
	.packs input[type='file'] {
		min-height: 2.75rem;
	}
	.install {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		gap: 0.5rem 0.75rem;
		margin: 1rem 0;
	}
	.file {
		display: grid;
		gap: 0.25rem;
	}
	.progress {
		display: grid;
		gap: 0.4rem;
		margin: 0.75rem 0;
	}
	.progress progress {
		width: 100%;
		max-width: 28rem;
	}
	.review,
	.pack-list li {
		border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
		border-radius: 0.4rem;
		padding: 0.6rem 0.75rem;
	}
	.review {
		margin: 1rem 0;
	}
	dl {
		display: grid;
		grid-template-columns: max-content 1fr;
		gap: 0.25rem 1rem;
		margin: 0.5rem 0;
	}
	dt {
		font-weight: 600;
	}
	dd {
		margin: 0;
		overflow-wrap: anywhere;
	}
	.licence {
		font-weight: 600;
	}
	.notice-text {
		white-space: pre-line;
	}
	.caution {
		border-left: 4px solid #b45309;
		padding: 0.4rem 0.75rem;
		font-weight: 600;
	}
	.replaces {
		margin: 0.5rem 0;
		padding-left: 1.2rem;
	}
	.replaces .changed {
		font-weight: 700;
		text-decoration: underline;
	}
	.confirm {
		display: flex;
		gap: 0.6rem;
		align-items: flex-start;
		margin: 0.75rem 0;
	}
	.confirm input {
		width: 1.4rem;
		height: 1.4rem;
		flex: none;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
	.pack-list {
		list-style: none;
		margin: 0 0 1rem;
		padding: 0;
		display: grid;
		gap: 0.5rem;
	}
	.pack-list p {
		margin: 0.25rem 0;
	}
	.pack-head {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 0.75rem;
		align-items: baseline;
	}
	.label {
		opacity: 0.75;
	}
	.unrecorded {
		font-style: italic;
	}
	.hint {
		opacity: 0.75;
	}
	.error {
		color: #b42318;
	}
	@media (prefers-color-scheme: dark) {
		.error {
			color: #ff8a80;
		}
	}
	.sr {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
	}
	dialog {
		max-width: min(32rem, 92vw);
	}
</style>
