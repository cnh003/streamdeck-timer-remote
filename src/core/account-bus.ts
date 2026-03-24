import type { BusData, BusStats } from "./types.js";

/**
 * Interface that every backend bus must implement.
 *
 * One bus instance exists per unique accountKey.  It owns the network polling
 * cycle, notifies all subscribers after each poll, and exposes timer mutation
 * methods.  The bus is completely idle when it has no subscribers.
 *
 * Actions obtain and release a bus via the endpoint-specific factory functions
 * (e.g. getBus / releaseBus in endpoints/traggo/traggo-bus.ts).
 */
export interface IAccountBus {
	/**
	 * Register a subscriber.  The bus starts (or continues) polling and will
	 * call `cb` with fresh data after each poll cycle, and immediately once
	 * with cached data if any is already available.
	 *
	 * @param token      Unique symbol identifying this subscriber (for removal).
	 * @param intervalMs Desired poll interval in milliseconds.
	 *                   The bus uses the minimum across all subscribers.
	 * @param cb         Called after every successful poll.
	 */
	subscribe(token: symbol, intervalMs: number, cb: (data: BusData) => void): void;

	/**
	 * Remove a subscriber.  When the last subscriber is removed the bus stops
	 * polling and may be garbage-collected by the registry.
	 */
	unsubscribe(token: symbol): void;

	/**
	 * Notify the bus that a subscriber's desired interval has changed.
	 * The bus recalculates its effective polling rate immediately.
	 */
	updateInterval(token: symbol, intervalMs: number): void;

	/**
	 * Stop the currently running timer, then immediately re-poll and notify
	 * all subscribers with the new state.
	 */
	stopTimer(id: number): Promise<void>;

	/**
	 * Start a new timer for the given tag, then immediately re-poll and notify
	 * all subscribers with the new state.
	 */
	startTimer(tagKey: string, note: string): Promise<void>;

	/**
	 * Returns a synchronous snapshot of diagnostic stats for the debug overlay.
	 * All fields are derived from cached state — no network call is made.
	 */
	getStats(): BusStats;
}
