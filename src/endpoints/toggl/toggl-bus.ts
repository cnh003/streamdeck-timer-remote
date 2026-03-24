import type { IAccountBus } from "../../core/account-bus.js";
import type { BusData, BusStats, TagDefinition } from "../../core/types.js";
import { getTogglAccounts, togglAccountKey, type TogglAccount } from "./accounts.js";
import { fetchCurrentEntry, buildTimerInfo } from "./timer.js";
import { fetchTags } from "./tags.js";
import { startTimer, stopTimer } from "./timer-actions.js";
import { getRateLimitInfo } from "./toggl-api.js";

/** Projects rarely change — only re-fetch after this many milliseconds. */
const TAG_CACHE_TTL_MS = 60 * 60 * 1_000; // 1 hour

type Subscriber = { intervalMs: number; cb: (data: BusData) => void };

class TogglAccountBus implements IAccountBus {
	private readonly _accountKey: string;
	private readonly _subscribers = new Map<symbol, Subscriber>();
	private _handle: ReturnType<typeof setInterval> | null = null;
	private _lastData: BusData = { timer: { running: false }, tags: [] };
	private _pollInFlight = false;
	private _tagCache: TagDefinition[] = [];
	private _tagCacheTime = 0; // Date.now() of last successful tag fetch
	// ── Stats tracking ────────────────────────────────────────────────────
	private _lastPollEndedAt  = 0;
	private _lastPollOk: boolean | null = null;
	private _cachedAccount: TogglAccount | null = null;
	// ── Rate-limit retry ────────────────────────────────────────────────
	private _rateLimitRetryHandle: ReturnType<typeof setTimeout> | null = null;

	constructor(accountKey: string) {
		this._accountKey = accountKey;
	}

	subscribe(token: symbol, intervalMs: number, cb: (data: BusData) => void): void {
		this._subscribers.set(token, { intervalMs, cb });
		this._restartPoll();
		cb(this._lastData); // deliver cached data immediately
	}

	unsubscribe(token: symbol): void {
		this._subscribers.delete(token);
		if (this._subscribers.size === 0) {
			this._stopPoll();
			this._cancelRateLimitRetry();
			_registry.delete(this._accountKey);
		} else {
			this._restartPoll();
		}
	}

	updateInterval(token: symbol, intervalMs: number): void {
		const sub = this._subscribers.get(token);
		if (!sub) return;
		sub.intervalMs = intervalMs;
		this._restartPoll();
	}

	async stopTimer(id: number): Promise<void> {
		const account = await this._resolveAccount();
		if (!account) return;
		await stopTimer(account.apiToken, account.workspaceId, id);
		await this._poll();
	}

	async startTimer(tagKey: string, note: string): Promise<void> {
		const account = await this._resolveAccount();
		if (!account) return;
		await startTimer(account.apiToken, account.workspaceId, tagKey, note);
		await this._poll();
	}

	getStats(): BusStats {
		const now = Date.now();
		const parts = this._accountKey.split('||');
		const rl = this._cachedAccount ? getRateLimitInfo(this._cachedAccount.apiToken) : null;
		return {
			accountLabel:       this._cachedAccount?.email        ?? parts[2] ?? this._accountKey,
			service:            'Toggl',
			serviceDetail:      this._cachedAccount?.workspaceName ?? `ws ${parts[1] ?? '?'}`,
			rateLimitRemaining: rl?.remaining ?? null,
			rateLimitReset:     rl?.resetAt   ?? null,
			nextPollInMs:       this._handle !== null && this._lastPollEndedAt > 0
			                      ? Math.max(0, this._lastPollEndedAt + this._minIntervalMs() - now)
			                      : null,
			lastPollTime:       this._lastPollEndedAt > 0 ? new Date(this._lastPollEndedAt) : null,
			lastPollOk:         this._lastPollOk,
		};
	}

	private _minIntervalMs(): number {
		let min = Infinity;
		for (const { intervalMs } of this._subscribers.values()) {
			if (intervalMs < min) min = intervalMs;
		}
		return Number.isFinite(min) ? min : 60_000;
	}

	private _restartPoll(): void {
		this._stopPoll();
		if (this._subscribers.size === 0) return;
		void this._poll();
		this._handle = setInterval(() => void this._poll(), this._minIntervalMs());
	}

	private _stopPoll(): void {
		if (this._handle !== null) {
			clearInterval(this._handle);
			this._handle = null;
		}
	}

	private _cancelRateLimitRetry(): void {
		if (this._rateLimitRetryHandle !== null) {
			clearTimeout(this._rateLimitRetryHandle);
			this._rateLimitRetryHandle = null;
		}
	}

	private _scheduleRateLimitRetry(resetAt: Date): void {
		this._cancelRateLimitRetry();
		const delayMs = Math.max(0, resetAt.getTime() - Date.now()) + 500; // +500ms buffer
		this._rateLimitRetryHandle = setTimeout(() => {
			this._rateLimitRetryHandle = null;
			void this._poll();
		}, delayMs);
	}

	private async _resolveAccount() {
		const accounts = await getTogglAccounts();
		const found = accounts.find(a => togglAccountKey(a) === this._accountKey) ?? null;
		this._cachedAccount = found;
		return found;
	}

	private async _poll(): Promise<void> {
		if (this._pollInFlight) return;
		this._pollInFlight = true;
		try {
			const account = await this._resolveAccount();
			if (account) {
				try {
					// Only re-fetch projects when the cache has expired.
					const tagsExpired = Date.now() - this._tagCacheTime > TAG_CACHE_TTL_MS;
					const [entry, freshTags] = await Promise.all([
						fetchCurrentEntry(account.apiToken),
						tagsExpired ? fetchTags(account.apiToken, account.workspaceId) : Promise.resolve(null),
					]);
					if (freshTags !== null) {
						this._tagCache = freshTags;
						this._tagCacheTime = Date.now();
					}
					const tags = this._tagCache;
					this._lastData = { timer: buildTimerInfo(entry, tags), tags };
					this._lastPollOk = true;
					this._cancelRateLimitRetry();
				} catch {
					this._lastPollOk = false;
					// Check whether the failure was due to rate limiting.
					const rl = getRateLimitInfo(account.apiToken);
					if (rl && rl.remaining === 0) {
						this._lastData = { ...this._lastData, rateLimitReset: rl.resetAt };
						this._scheduleRateLimitRetry(rl.resetAt);
					}
				}
			} else {
				this._lastData = { timer: { running: false }, tags: [] };
			}
			this._lastPollEndedAt = Date.now();
			for (const { cb } of this._subscribers.values()) {
				cb(this._lastData);
			}
		} finally {
			this._pollInFlight = false;
		}
	}
}

const _registry = new Map<string, TogglAccountBus>();

/**
 * Returns (or creates) the singleton bus for the given Toggl accountKey.
 * The bus removes itself from the registry when the last subscriber leaves.
 */
export function getBus(accountKey: string): IAccountBus {
	let bus = _registry.get(accountKey);
	if (!bus) {
		bus = new TogglAccountBus(accountKey);
		_registry.set(accountKey, bus);
	}
	return bus;
}
