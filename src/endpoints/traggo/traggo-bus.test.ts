import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Types ───────────────────────────────────────────────────────────────────

type BusMod = typeof import("./traggo-bus.js");

// ── Shared state, reset per test ────────────────────────────────────────────

let getBus: BusMod["getBus"];

let mockGetAccounts:     ReturnType<typeof vi.fn>;
let mockGetRunningTimer: ReturnType<typeof vi.fn>;
let mockFetchTags:       ReturnType<typeof vi.fn>;
let mockStartTimerFn:    ReturnType<typeof vi.fn>;
let mockStopTimerFn:     ReturnType<typeof vi.fn>;

const ACCOUNT     = { url: "http://host", username: "user", token: "tok", deviceId: 1 };
const ACCOUNT_KEY = "http://host||user||1";

// Flush all pending awaits inside _poll() (chained async calls).
async function flushPoll() {
	for (let i = 0; i < 10; i++) await Promise.resolve();
}

beforeEach(async () => {
	vi.useFakeTimers();
	vi.resetModules();

	mockGetAccounts     = vi.fn().mockResolvedValue([ACCOUNT]);
	mockGetRunningTimer = vi.fn().mockResolvedValue({ running: false });
	mockFetchTags       = vi.fn().mockResolvedValue([]);
	mockStartTimerFn    = vi.fn().mockResolvedValue(undefined);
	mockStopTimerFn     = vi.fn().mockResolvedValue(undefined);

	vi.doMock("./accounts.js",      () => ({ getAccounts:     mockGetAccounts     }));
	vi.doMock("./timer.js",         () => ({ getRunningTimer: mockGetRunningTimer }));
	vi.doMock("./tags.js",          () => ({ fetchTags:       mockFetchTags       }));
	vi.doMock("./timer-actions.js", () => ({ startTimer: mockStartTimerFn, stopTimer: mockStopTimerFn }));

	const mod = await import("./traggo-bus.js");
	getBus = mod.getBus;
});

afterEach(() => {
	vi.useRealTimers();
});

// ── getBus ─────────────────────────────────────────────────────────────────

describe("getBus", () => {
	it("returns an IAccountBus with the expected interface", () => {
		const bus = getBus(ACCOUNT_KEY);
		expect(bus.subscribe).toBeInstanceOf(Function);
		expect(bus.unsubscribe).toBeInstanceOf(Function);
		expect(bus.updateInterval).toBeInstanceOf(Function);
		expect(bus.startTimer).toBeInstanceOf(Function);
		expect(bus.stopTimer).toBeInstanceOf(Function);
	});

	it("returns the same instance for the same accountKey", () => {
		expect(getBus(ACCOUNT_KEY)).toBe(getBus(ACCOUNT_KEY));
	});

	it("returns different instances for different accountKeys", () => {
		expect(getBus("key-a")).not.toBe(getBus("key-b"));
	});

	it("creates a fresh instance after the last subscriber unsubscribes", () => {
		const token = Symbol("t");
		const bus1  = getBus(ACCOUNT_KEY);
		bus1.subscribe(token, 60_000, vi.fn());
		bus1.unsubscribe(token);

		const bus2 = getBus(ACCOUNT_KEY);
		expect(bus2).not.toBe(bus1);
	});
});

// ── subscribe ──────────────────────────────────────────────────────────────

describe("subscribe", () => {
	it("delivers empty cached data synchronously on the initial subscription", () => {
		const cb = vi.fn();
		getBus(ACCOUNT_KEY).subscribe(Symbol("t"), 60_000, cb);

		expect(cb).toHaveBeenCalledOnce();
		expect(cb).toHaveBeenCalledWith({ timer: { running: false }, tags: [] });
	});

	it("also notifies the subscriber with polled data once the initial poll resolves", async () => {
		const timer = { running: true, id: 1, tagKey: "work", color: "#f00", startTime: new Date() };
		mockGetRunningTimer.mockResolvedValue(timer);
		mockFetchTags.mockResolvedValue([{ key: "work", color: "#f00" }]);

		const cb = vi.fn();
		getBus(ACCOUNT_KEY).subscribe(Symbol("t"), 60_000, cb);
		await flushPoll();

		// Two calls: synchronous empty data + async polled data
		expect(cb).toHaveBeenCalledTimes(2);
		expect(cb).toHaveBeenLastCalledWith({
			timer,
			tags: [{ key: "work", color: "#f00" }],
		});
	});

	it("all subscribers receive the same polled data", async () => {
		const cbA = vi.fn();
		const cbB = vi.fn();
		const bus = getBus(ACCOUNT_KEY);
		bus.subscribe(Symbol("a"), 60_000, cbA);
		bus.subscribe(Symbol("b"), 60_000, cbB);
		await flushPoll();

		// Both should have received at least the initial sync call plus the poll
		expect(cbA.mock.calls.length).toBeGreaterThanOrEqual(2);
		expect(cbB.mock.calls.length).toBeGreaterThanOrEqual(2);
		expect(cbA).toHaveBeenLastCalledWith(expect.objectContaining({ timer: { running: false }, tags: [] }));
		expect(cbB).toHaveBeenLastCalledWith(expect.objectContaining({ timer: { running: false }, tags: [] }));
	});

	it("does not call getRunningTimer/fetchTags when the account is not found", async () => {
		mockGetAccounts.mockResolvedValue([]);

		const cb = vi.fn();
		getBus("unknown||key").subscribe(Symbol("t"), 60_000, cb);
		await flushPoll();

		expect(mockGetRunningTimer).not.toHaveBeenCalled();
		expect(mockFetchTags).not.toHaveBeenCalled();
		expect(cb).toHaveBeenLastCalledWith({ timer: { running: false }, tags: [] });
	});

	it("fires the poll again on the setInterval tick", async () => {
		getBus(ACCOUNT_KEY).subscribe(Symbol("t"), 5_000, vi.fn());
		await flushPoll();

		const countAfterInitial = mockGetAccounts.mock.calls.length;

		await vi.advanceTimersByTimeAsync(5_000);
		await flushPoll();

		expect(mockGetAccounts.mock.calls.length).toBeGreaterThan(countAfterInitial);
	});
});

// ── unsubscribe ────────────────────────────────────────────────────────────

describe("unsubscribe", () => {
	it("removes the bus from the registry when the last subscriber leaves", () => {
		const token = Symbol("t");
		const bus1  = getBus(ACCOUNT_KEY);
		bus1.subscribe(token, 60_000, vi.fn());
		bus1.unsubscribe(token);

		expect(getBus(ACCOUNT_KEY)).not.toBe(bus1);
	});

	it("keeps the bus in the registry while other subscribers remain", () => {
		const tA  = Symbol("a");
		const tB  = Symbol("b");
		const bus = getBus(ACCOUNT_KEY);
		bus.subscribe(tA, 60_000, vi.fn());
		bus.subscribe(tB, 60_000, vi.fn());

		bus.unsubscribe(tA);

		expect(getBus(ACCOUNT_KEY)).toBe(bus);
	});

	it("stops notifying an unsubscribed callback on subsequent interval ticks", async () => {
		const cbA = vi.fn();
		const cbB = vi.fn();
		const tA  = Symbol("a");
		const tB  = Symbol("b");
		const bus = getBus(ACCOUNT_KEY);
		bus.subscribe(tA, 5_000, cbA);
		bus.subscribe(tB, 5_000, cbB);
		await flushPoll();

		const countA = cbA.mock.calls.length;
		bus.unsubscribe(tA);

		await vi.advanceTimersByTimeAsync(5_000);
		await flushPoll();

		// cbA must not have received any new calls; cbB should have gotten one more
		expect(cbA).toHaveBeenCalledTimes(countA);
		expect(cbB.mock.calls.length).toBeGreaterThan(countA);
	});

	it("stops all polling when the last subscriber unsubscribes", async () => {
		const token = Symbol("t");
		const bus   = getBus(ACCOUNT_KEY);
		bus.subscribe(token, 5_000, vi.fn());
		await flushPoll();

		bus.unsubscribe(token);
		const countAfterUnsub = mockGetAccounts.mock.calls.length;

		await vi.advanceTimersByTimeAsync(5_000);
		await flushPoll();

		expect(mockGetAccounts.mock.calls.length).toBe(countAfterUnsub);
	});
});

// ── updateInterval ─────────────────────────────────────────────────────────

describe("updateInterval", () => {
	it("does not throw when called with an unknown token", () => {
		const bus = getBus(ACCOUNT_KEY);
		bus.subscribe(Symbol("a"), 60_000, vi.fn());
		expect(() => bus.updateInterval(Symbol("unknown"), 1_000)).not.toThrow();
	});

	it("restarts polling at the new interval", async () => {
		const token = Symbol("t");
		const bus   = getBus(ACCOUNT_KEY);
		bus.subscribe(token, 60_000, vi.fn());
		await flushPoll();

		const countBefore = mockGetAccounts.mock.calls.length;

		bus.updateInterval(token, 2_000);
		await flushPoll(); // initial poll from restartPoll

		await vi.advanceTimersByTimeAsync(2_000);
		await flushPoll();

		// Should have polled at least once more since the restart
		expect(mockGetAccounts.mock.calls.length).toBeGreaterThan(countBefore);
	});
});

// ── stopTimer ──────────────────────────────────────────────────────────────

describe("stopTimer", () => {
	it("calls the stopTimer action with the correct URL, token, and id", async () => {
		const bus = getBus(ACCOUNT_KEY);
		bus.subscribe(Symbol("t"), 60_000, vi.fn());

		await bus.stopTimer(42);

		expect(mockStopTimerFn).toHaveBeenCalledOnce();
		const [url, tok, id] = mockStopTimerFn.mock.calls[0];
		expect(url).toBe("http://host");
		expect(tok).toBe("tok");
		expect(id).toBe(42);
	});

	it("re-polls after stopping and notifies subscribers with updated data", async () => {
		const cb  = vi.fn();
		const bus = getBus(ACCOUNT_KEY);
		bus.subscribe(Symbol("t"), 60_000, cb);
		await flushPoll();

		const countBefore = cb.mock.calls.length;
		await bus.stopTimer(1);

		expect(cb.mock.calls.length).toBeGreaterThan(countBefore);
	});

	it("does nothing when the account is not found", async () => {
		mockGetAccounts.mockResolvedValue([]);
		const bus = getBus("unknown||key");
		bus.subscribe(Symbol("t"), 60_000, vi.fn());

		await bus.stopTimer(1);

		expect(mockStopTimerFn).not.toHaveBeenCalled();
	});
});

// ── startTimer ─────────────────────────────────────────────────────────────

describe("startTimer", () => {
	it("calls the startTimer action with the correct URL, token, tagKey, and note", async () => {
		const bus = getBus(ACCOUNT_KEY);
		bus.subscribe(Symbol("t"), 60_000, vi.fn());

		await bus.startTimer("work", "my task");

		expect(mockStartTimerFn).toHaveBeenCalledOnce();
		const [url, tok, tagKey, note] = mockStartTimerFn.mock.calls[0];
		expect(url).toBe("http://host");
		expect(tok).toBe("tok");
		expect(tagKey).toBe("work");
		expect(note).toBe("my task");
	});

	it("re-polls after starting and notifies subscribers with updated data", async () => {
		const cb  = vi.fn();
		const bus = getBus(ACCOUNT_KEY);
		bus.subscribe(Symbol("t"), 60_000, cb);
		await flushPoll();

		const countBefore = cb.mock.calls.length;
		await bus.startTimer("work", "-");

		expect(cb.mock.calls.length).toBeGreaterThan(countBefore);
	});

	it("does nothing when the account is not found", async () => {
		mockGetAccounts.mockResolvedValue([]);
		const bus = getBus("unknown||key");
		bus.subscribe(Symbol("t"), 60_000, vi.fn());

		await bus.startTimer("work", "note");

		expect(mockStartTimerFn).not.toHaveBeenCalled();
	});
});
