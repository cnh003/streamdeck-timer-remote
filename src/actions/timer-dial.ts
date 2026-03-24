import streamDeck from "@elgato/streamdeck";
import {
	action,
	DialRotateEvent,
	DialUpEvent,
	DidReceiveSettingsEvent,
	PropertyInspectorDidAppearEvent,
	SendToPluginEvent,
	SingletonAction,
	TouchTapEvent,
	WillAppearEvent,
	WillDisappearEvent,
	type DialAction,
} from "@elgato/streamdeck";
import type { JsonValue } from "@elgato/utils";
import type { IAccountBus } from "../core/account-bus.js";
import type { BusData, TagDefinition } from "../core/types.js";
import { buildDialImage, buildDebugImage, buildRateLimitDialImage } from "../core/dial-image.js";
import { formatElapsed } from "../core/format.js";
import { isValidAccountKey } from "../endpoints/account-summary.js";

/** Per-action persisted settings — no tag field; tag is selected by rotating the dial. */
export type TimerDialSettings = {
	/** Composite key `"${url}||${username}||${deviceId}"` identifying the chosen account. */
	accountKey?: string;
	/** Polling/refresh interval in seconds (stored as string from the select). */
	interval?: string;
	/** User-defined order of all known tag keys; used for sorting the dial rotation. */
	tagOrder?: string[];
	/** Tag keys the user has chosen to include in the dial rotation. Empty/absent = all tags. */
	selectedTagKeys?: string[];
	/** Per-tag custom display name and note/comment, keyed by tag key. */
	tagMeta?: Record<string, { displayName?: string; note?: string }>;
	/** When true the dial canvas shows diagnostic stats instead of normal display. */
	debug?: boolean;
};

function deriveTagList(settings: TimerDialSettings, allTags: TagDefinition[]): TagDefinition[] {
	const tagOrder = settings.tagOrder ?? [];
	const selected = settings.selectedTagKeys ?? [];

	const sorted = tagOrder.length > 0
		? [...allTags].sort((a, b) => {
				const ai = tagOrder.indexOf(a.key);
				const bi = tagOrder.indexOf(b.key);
				return (ai === -1 ? Infinity : ai) - (bi === -1 ? Infinity : bi);
			})
		: allTags;

	return (tagOrder.length === 0 && selected.length === 0)
		? sorted
		: sorted.filter(t => selected.includes(t.key) || !tagOrder.includes(t.key));
}

@action({ UUID: "de.grey-scaled.time-tracker-remote.timer-dial" })
export class TimerDial extends SingletonAction<TimerDialSettings> {
	private readonly _getBus: (accountKey: string) => IAccountBus;
	private readonly _handlePI: (payload: JsonValue) => Promise<void>;

	private readonly _busMap    = new Map<string, IAccountBus>();
	private readonly _tokenMap  = new Map<string, symbol>();
	private readonly _dataCache = new Map<string, BusData>();
	private readonly _settings  = new Map<string, TimerDialSettings>();
	private readonly _tagList   = new Map<string, TagDefinition[]>();
	private readonly _tagIndex  = new Map<string, number>();
	private _fastHandle: ReturnType<typeof setInterval> | null = null;

	constructor(
		getBus: (accountKey: string) => IAccountBus,
		handlePI: (payload: JsonValue) => Promise<void>,
	) {
		super();
		this._getBus = getBus;
		this._handlePI = handlePI;
	}

	override async onWillAppear(ev: WillAppearEvent<TimerDialSettings>): Promise<void> {
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
		this._tagList.set(id, []);
		this._tagIndex.set(id, 0);

		const act = ev.action as DialAction<TimerDialSettings>;
		await act.setFeedbackLayout("layouts/dial.json");

		this._subscribe(id, settings);
	}

	override async onWillDisappear(ev: WillDisappearEvent<TimerDialSettings>): Promise<void> {
		const { id } = ev.action;
		this._unsubscribe(id);
		this._settings.delete(id);
		this._dataCache.delete(id);
		this._tagList.delete(id);
		this._tagIndex.delete(id);
	}

	override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<TimerDialSettings>): Promise<void> {
		const { id } = ev.action;
		const settings = ev.payload.settings;
		this._unsubscribe(id);
		this._settings.set(id, settings);
		this._subscribe(id, settings);
	}

	override async onSendToPlugin(
		ev: SendToPluginEvent<JsonValue, TimerDialSettings>
	): Promise<void> {
		await this._handlePI(ev.payload);
	}

	override async onPropertyInspectorDidAppear(
		ev: PropertyInspectorDidAppearEvent<TimerDialSettings>
	): Promise<void> {
		const { id } = ev.action;
		const tags = this._tagList.get(id) ?? [];
		const tagIndex = this._tagIndex.get(id) ?? 0;
		const currentTagKey = tags[tagIndex]?.key ?? null;
		await streamDeck.ui.sendToPropertyInspector({ type: "dialState", currentTagKey });
	}

	// ── Dial events ──────────────────────────────────────────────────────────

	override onDialRotate(ev: DialRotateEvent<TimerDialSettings>): void {
		const { id } = ev.action;
		const tags = this._tagList.get(id) ?? [];
		if (tags.length === 0) return;
		const current = this._tagIndex.get(id) ?? 0;
		const next = ((current + ev.payload.ticks) % tags.length + tags.length) % tags.length;
		this._tagIndex.set(id, next);
		this._refreshFeedbackForId(id);
	}

	override async onDialUp(ev: DialUpEvent<TimerDialSettings>): Promise<void> {
		await this._handleToggle(ev.action.id);
	}

	/** Touch tap: jump the dial to whichever tag's timer is currently running. */
	override onTouchTap(ev: TouchTapEvent<TimerDialSettings>): void {
		const { id } = ev.action;
		const info = this._dataCache.get(id)?.timer ?? { running: false };
		if (!info.running) return;

		const tags = this._tagList.get(id) ?? [];
		const idx  = tags.findIndex(t => t.key === (info as { tagKey: string | null }).tagKey);
		if (idx === -1) return; // running tag not in the filtered list

		this._tagIndex.set(id, idx);
		this._refreshFeedbackForId(id);
	}

	private async _handleToggle(id: string): Promise<void> {
		const bus = this._busMap.get(id);
		if (!bus) return;

		const info           = this._dataCache.get(id)?.timer ?? { running: false };
		const tags           = this._tagList.get(id) ?? [];
		const tagIndex       = this._tagIndex.get(id) ?? 0;
		const selectedTagKey = tags[tagIndex]?.key;

		let state: 1 | 2 | 3;
		if (!info.running)                                            state = 1;
		else if (selectedTagKey && (info as { tagKey: string | null }).tagKey === selectedTagKey) state = 2;
		else                                                          state = 3;

		if ((state === 2 || state === 3) && info.running) {
			await bus.stopTimer((info as { id: number }).id);
		}
		if ((state === 1 || state === 3) && selectedTagKey) {
			const settings_ = this._settings.get(id) ?? {};
			const note = settings_.tagMeta?.[selectedTagKey]?.note ?? "";
			await bus.startTimer(selectedTagKey, note);
		}
	}

	// ── Subscription management ──────────────────────────────────────────────

	private _subscribe(id: string, settings: TimerDialSettings): void {
		if (!settings.accountKey) {
			this._refreshFeedbackForId(id);
			return;
		}
		const token = Symbol(`timer-dial:${id}`);
		this._tokenMap.set(id, token);
		const intervalMs = Math.max(1, Number.parseInt(settings.interval ?? "60", 10)) * 1_000;
		const bus = this._getBus(settings.accountKey);
		this._busMap.set(id, bus);
		bus.subscribe(token, intervalMs, (data) => this._onBusData(id, data));
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

	private _onBusData(id: string, data: BusData): void {
		this._dataCache.set(id, data);
		const settings = this._settings.get(id) ?? {};
		const newList  = deriveTagList(settings, data.tags);

		// Preserve the selected tag by key when the list refreshes.
		const prevList  = this._tagList.get(id) ?? [];
		const prevIndex = this._tagIndex.get(id) ?? 0;
		const prevKey   = prevList[prevIndex]?.key;
		this._tagList.set(id, newList);
		const newIndex = prevKey ? Math.max(0, newList.findIndex(t => t.key === prevKey)) : 0;
		this._tagIndex.set(id, newIndex);

		this._refreshFeedbackForId(id);
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
			this._refreshFeedbackForId(act.id);
		}
	}

	// ── Feedback rendering ───────────────────────────────────────────────────

	private _refreshFeedbackForId(id: string): void {
		const act = [...this.actions].find(a => a.id === id) as DialAction<TimerDialSettings> | undefined;
		if (!act) return;

		const settings_ = this._settings.get(id) ?? {};
		const bus       = this._busMap.get(id);

		// ── Rate-limit error ───────────────────────────────────────────────────
		const cached = this._dataCache.get(id);
		if (cached?.rateLimitReset) {
			const secsLeft = Math.max(0, Math.ceil((cached.rateLimitReset.getTime() - Date.now()) / 1_000));
			const mm = String(Math.floor(secsLeft / 60)).padStart(2, '0');
			const ss = String(secsLeft % 60).padStart(2, '0');
			void act.setFeedback({ full: buildRateLimitDialImage(`${mm}:${ss}`) } as Record<string, string>);
			return;
		}

		// ── Debug mode ─────────────────────────────────────────────────────────
		if (settings_.debug && bus) {
			const tags     = this._tagList.get(id) ?? [];
			const tagIndex = this._tagIndex.get(id) ?? 0;
			const selected = tags[tagIndex];
			const rawKey   = selected?.key ?? null;
			const label    = rawKey
				? (settings_.tagMeta?.[rawKey]?.displayName || selected?.label || rawKey)
				: null;
			void act.setFeedback({ full: buildDebugImage(bus.getStats(), label) } as Record<string, string>);
			return;
		}

		// ── Normal mode ─────────────────────────────────────────────────────────
		const info     = cached?.timer ?? { running: false };
		const tags     = this._tagList.get(id) ?? [];
		const tagIndex = this._tagIndex.get(id) ?? 0;
		const selected = tags[tagIndex];

		const runningInfo = info.running ? info : null;
		let state: 'idle' | 'running' | 'other';
		if (!info.running) {
			state = 'idle';
		} else if (selected != null && runningInfo?.tagKey === selected.key) {
			state = 'running';
		} else {
			state = 'other';
		}
		const rawKey      = selected?.key ?? null;
		const displayName = rawKey
			? (settings_.tagMeta?.[rawKey]?.displayName || selected?.label || rawKey)
			: null;
		const tagColor    = selected?.color ?? "#888888";
		const elapsed     = state === 'running' && runningInfo ? formatElapsed(runningInfo.startTime) : null;

		void act.setFeedback({ full: buildDialImage(state, displayName, tagColor, elapsed) } as Record<string, string>);
	}
}

