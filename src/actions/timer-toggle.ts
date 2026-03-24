import { action, DidReceiveSettingsEvent, KeyUpEvent, SendToPluginEvent, SingletonAction, WillAppearEvent, WillDisappearEvent } from "@elgato/streamdeck";
import type { JsonValue } from "@elgato/utils";
import type { IAccountBus } from "../core/account-bus.js";
import type { BusData, TimerInfo } from "../core/types.js";
import { buildImage, buildRateLimitImage } from "../core/toggle-image.js";
import { formatElapsed } from "../core/format.js";
import { isValidAccountKey } from "../endpoints/account-summary.js";

/** Per-action persisted settings. The accounts list lives in global settings. */
export type TimerToggleSettings = {
	/** Composite key `"${url}||${username}||${deviceId}"` identifying the chosen account. */
	accountKey?: string;
	/** Tag key to attach to the new time span. */
	tagKey?: string;
	/** Free-text note for the time span. */
	note?: string;
	/** Polling/refresh interval in seconds (stored as string from the select). */
	interval?: string;
	/** Whether to show the tag name on the button. Defaults to true. */
	showTagName?: boolean;
	/** Whether to show the elapsed time on the button. Defaults to true. */
	showElapsed?: boolean;
};

/**
 * State 1: no timer running.
 * State 2: timer running with the same tag as configured — "this timer is mine".
 * State 3: timer running with a different tag — "someone else's timer".
 */
function determineState(info: TimerInfo, settings: TimerToggleSettings | undefined): 1 | 2 | 3 {
	if (!info.running) return 1;
	if (settings?.tagKey && info.tagKey === settings.tagKey) return 2;
	return 3;
}

@action({ UUID: "de.grey-scaled.time-tracker-remote.timer-toggle" })
export class TimerToggle extends SingletonAction<TimerToggleSettings> {
	private readonly _getBus: (accountKey: string) => IAccountBus;
	private readonly _handlePI: (payload: JsonValue) => Promise<void>;

	private readonly _busMap    = new Map<string, IAccountBus>();
	private readonly _tokenMap  = new Map<string, symbol>();
	private readonly _dataCache = new Map<string, BusData>();
	private readonly _settings  = new Map<string, TimerToggleSettings>();
	private _fastHandle: ReturnType<typeof setInterval> | null = null;

	constructor(
		getBus: (accountKey: string) => IAccountBus,
		handlePI: (payload: JsonValue) => Promise<void>,
	) {
		super();
		this._getBus = getBus;
		this._handlePI = handlePI;
	}

	override async onWillAppear(ev: WillAppearEvent<TimerToggleSettings>): Promise<void> {
		const { id } = ev.action;
		let settings = ev.payload.settings;
		// If the saved accountKey no longer exists (e.g. logged out while this button
		// was on a hidden page), clear it so the button shows the unconfigured state.
		if (settings.accountKey) {
			if (!await isValidAccountKey(settings.accountKey)) {
				settings = { ...settings, accountKey: undefined };
				await ev.action.setSettings(settings);
			}
		}
		this._settings.set(id, settings);
		this._subscribe(id, settings);
	}

	override async onWillDisappear(ev: WillDisappearEvent<TimerToggleSettings>): Promise<void> {
		const { id } = ev.action;
		this._unsubscribe(id);
		this._settings.delete(id);
		this._dataCache.delete(id);
	}

	override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<TimerToggleSettings>): Promise<void> {
		const { id } = ev.action;
		const settings = ev.payload.settings;
		this._unsubscribe(id);
		this._settings.set(id, settings);
		this._subscribe(id, settings);
	}

	override async onSendToPlugin(
		ev: SendToPluginEvent<JsonValue, TimerToggleSettings>
	): Promise<void> {
		await this._handlePI(ev.payload);
	}

	override async onKeyUp(ev: KeyUpEvent<TimerToggleSettings>): Promise<void> {
		const { id } = ev.action;
		const bus = this._busMap.get(id);
		if (!bus) return;
		const settings = this._settings.get(id);
		const info = this._dataCache.get(id)?.timer ?? { running: false };
		const state = determineState(info, settings);

		// State 2 & 3: stop whatever is currently running.
		if ((state === 2 || state === 3) && info.running) {
			await bus.stopTimer(info.id);
		}

		// State 1 & 3: start a new timer with the configured tag and note.
		if ((state === 1 || state === 3) && settings?.tagKey) {
			await bus.startTimer(settings.tagKey, settings.note?.trim() || "-");
		}
	}

	// ── Subscription management ──────────────────────────────────────────────

	private _subscribe(id: string, settings: TimerToggleSettings): void {
		if (!settings.accountKey) {
			this._refreshImageForId(id);
			return;
		}
		const token = Symbol(`timer-toggle:${id}`);
		this._tokenMap.set(id, token);
		const intervalMs = Math.max(1, Number.parseInt(settings.interval ?? "60", 10)) * 1_000;
		const bus = this._getBus(settings.accountKey);
		this._busMap.set(id, bus);
		bus.subscribe(token, intervalMs, (data) => {
			this._dataCache.set(id, data);
			this._refreshImageForId(id);
		});
		if (this._busMap.size === 1) this._startFastTick();
	}

	private _unsubscribe(id: string): void {
		const token = this._tokenMap.get(id);
		const bus   = this._busMap.get(id);
		if (token && bus) bus.unsubscribe(token);
		this._tokenMap.delete(id);
		this._busMap.delete(id);
		if (this._busMap.size === 0) this._stopFastTick();
	}

	// ── Fast tick (elapsed re-render) ────────────────────────────────────────

	private _startFastTick(): void {
		if (this._fastHandle !== null) return;
		this._fastHandle = setInterval(() => this._tick(), 1_000);
	}

	private _stopFastTick(): void {
		if (this._fastHandle === null) return;
		clearInterval(this._fastHandle);
		this._fastHandle = null;
	}

	private _tick(): void {
		for (const act of this.actions) {
			this._refreshImageForId(act.id);
		}
	}

	// ── Image rendering ──────────────────────────────────────────────────────

	private _refreshImageForId(id: string): void {
		const act = [...this.actions].find(a => a.id === id);
		if (!act) return;
		const settings    = this._settings.get(id);
		const cached      = this._dataCache.get(id);
		const info        = cached?.timer ?? { running: false };
		const tags        = cached?.tags  ?? [];
		const showTagName = settings?.showTagName !== false;
		const showElapsed = settings?.showElapsed !== false;

		// ── Rate-limit error ───────────────────────────────────────────────────
		if (cached?.rateLimitReset) {
			const secsLeft = Math.max(0, Math.ceil((cached.rateLimitReset.getTime() - Date.now()) / 1_000));
			const mm = String(Math.floor(secsLeft / 60)).padStart(2, '0');
			const ss = String(secsLeft % 60).padStart(2, '0');
			act.setImage(buildRateLimitImage(`${mm}:${ss}`)).catch(() => {});
			return;
		}

		/** Resolves a tag key to its human-readable label (falls back to the key itself). */
		const tagLabel = (key: string | null | undefined): string | null => {
			if (!key) return null;
			return tags.find(t => t.key === key)?.label ?? key;
		};

		// If the configured tag has been renamed or deleted on the server, warn.
		const tagKey = settings?.tagKey;
		const isTagMissing = !!tagKey && tags.length > 0 && !tags.some(t => t.key === tagKey);
		if (isTagMissing) {
			act.setImage(buildImage('warning', "#cc7700", showTagName ? tagLabel(tagKey) : null, "Tag missing")).catch(() => {});
			return;
		}

		const state = determineState(info, settings);
		if (state === 2 && info.running) {
			const elapsed = showElapsed ? formatElapsed(info.startTime) : null;
			act.setImage(buildImage('running', info.color, showTagName ? tagLabel(info.tagKey) : null, elapsed)).catch(() => {});
		} else if (state === 3) {
			act.setImage(buildImage('other', "#000000", showTagName ? tagLabel(settings?.tagKey) : null)).catch(() => {});
		} else {
			act.setImage(buildImage('idle', "#000000", showTagName ? tagLabel(settings?.tagKey) : null)).catch(() => {});
		}
	}
}
