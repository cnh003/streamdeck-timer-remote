/**
 * Shared domain types used across core and endpoints.
 * Keep this file free of any SDK or endpoint imports.
 */

/** A tag as returned by any time-tracking endpoint. */
export type TagDefinition = {
	key: string;
	color: string;
	/** Human-readable display name when it differs from the key (e.g. Toggl project name). */
	label?: string;
};

/**
 * The last known timer state fetched from a time-tracking backend.
 * A discriminated union so callers can narrow safely.
 */
export type TimerInfo =
	| { running: false }
	| {
		running: true;
		id: number;
		tagKey: string | null;
		color: string;
		startTime: Date;
	  };

/**
 * The data payload pushed to every subscriber after each backend poll.
 */
export type BusData = {
	timer: TimerInfo;
	tags: TagDefinition[];
	/** Set when the backend is rate-limited; cleared on the next successful poll. */
	rateLimitReset?: Date | null;
};

/**
 * Diagnostic stats exposed by every bus — used to render the debug overlay
 * on the dial canvas.  All fields are derived synchronously from cached state.
 */
export type BusStats = {
	/** Short identifier for the account (username or email). */
	accountLabel: string;
	/** Backend name, e.g. "Toggl" or "Traggo". */
	service: string;
	/** Extra context such as workspace name or server URL. */
	serviceDetail: string;
	/**
	 * Requests remaining in the current rate-limit window, as reported by the
	 * server (Toggl: X-RateLimit-Remaining).  Null when the backend provides
	 * no rate-limit information (e.g. Traggo) or before the first response.
	 */
	rateLimitRemaining: number | null;
	/** When the rate-limit window resets (server-reported), or null if unknown. */
	rateLimitReset: Date | null;
	/** Milliseconds until the next scheduled poll, or null when not polling. */
	nextPollInMs: number | null;
	/** Timestamp of the last completed poll, or null if never polled. */
	lastPollTime: Date | null;
	/** Whether the last poll succeeded. Null if never polled. */
	lastPollOk: boolean | null;
};
