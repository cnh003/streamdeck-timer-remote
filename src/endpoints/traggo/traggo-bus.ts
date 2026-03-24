import type { IAccountBus } from "../../core/account-bus.js";
import type { BusData, BusStats } from "../../core/types.js";
import { getAccounts } from "./accounts.js";
import { getRunningTimer } from "./timer.js";
import { fetchTags } from "./tags.js";
import { startTimer, stopTimer } from "./timer-actions.js";

type Subscriber = { intervalMs: number; cb: (data: BusData) => void };

class TraggoAccountBus implements IAccountBus {
	private readonly _accountKey: string;
	private readonly _subscribers = new Map<symbol, Subscriber>();
	private _handle: ReturnType<typeof setInterval> | null = null;
	private _lastData: BusData = { timer: { running: false }, tags: [] };
	private _pollInFlight = false;
	// ── Stats tracking ────────────────────────────────────────────────────
	private _lastPollEndedAt  = 0;
	private _lastPollOk: boolean | null = null;

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
		await stopTimer(account.url, account.token, id);
		await this._poll();
	}

	async startTimer(tagKey: string, note: string): Promise<void> {
		const account = await this._resolveAccount();
		if (!account) return;
		await startTimer(account.url, account.token, tagKey, note);
		await this._poll();
	}

	getStats(): BusStats {
		const now = Date.now();
		const parts = this._accountKey.split('||');
		return {
			accountLabel:       parts[1] ?? this._accountKey,
			service:            'Traggo',
			serviceDetail:      parts[0] ?? '',
			rateLimitRemaining: null,
			rateLimitReset:     null,
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

	private async _resolveAccount() {
		const accounts = await getAccounts();
		return accounts.find(a => `${a.url}||${a.username}||${a.deviceId}` === this._accountKey) ?? null;
	}

	private async _poll(): Promise<void> {
		if (this._pollInFlight) return;
		this._pollInFlight = true;
		try {
			const account = await this._resolveAccount();
			if (account) {
				try {
					const [timer, tags] = await Promise.all([
						getRunningTimer(account.url, account.token),
						fetchTags(account.url, account.token),
					]);
					this._lastData = { timer, tags };
					this._lastPollOk = true;
				} catch {
					this._lastPollOk = false;
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

const _registry = new Map<string, TraggoAccountBus>();

/**
 * Returns (or creates) the singleton bus for the given accountKey.
 * The bus is removed from the registry automatically when the last
 * subscriber unsubscribes.
 */
export function getBus(accountKey: string): IAccountBus {
	let bus = _registry.get(accountKey);
	if (!bus) {
		bus = new TraggoAccountBus(accountKey);
		_registry.set(accountKey, bus);
	}
	return bus;
}
