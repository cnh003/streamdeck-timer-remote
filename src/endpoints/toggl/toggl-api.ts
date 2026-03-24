const BASE_URL = "https://api.track.toggl.com/api/v9";

/** Server-reported rate-limit info, keyed by API token. */
export type RateLimitInfo = {
	remaining: number;
	resetAt: Date;
};

/** Updated after every successful Toggl API response that includes rate-limit headers. */
const _rateLimitRegistry = new Map<string, RateLimitInfo>();

/** Returns the last known rate-limit state for the given API token, or null if not yet seen. */
export function getRateLimitInfo(apiToken: string): RateLimitInfo | null {
	return _rateLimitRegistry.get(apiToken) ?? null;
}

/**
 * Makes an authenticated request to the Toggl Track v9 REST API.
 * Authentication uses HTTP Basic Auth with the API token as the username
 * and the literal string "api_token" as the password.
 *
 * Each call automatically updates the shared rate-limit registry so that
 * `getRateLimitInfo(apiToken)` always reflects the latest server-reported quota.
 */
export async function togglFetch<T>(
	path: string,
	apiToken: string,
	options: RequestInit = {},
): Promise<T> {
	const res = await fetch(`${BASE_URL}${path}`, {
		...options,
		headers: {
			"Content-Type": "application/json",
			"Authorization": `Basic ${btoa(`${apiToken}:api_token`)}`,
			...(options.headers ?? {}),
		},
	});

	// x-toggl-quota-remaining: requests left in the current window
	// x-toggl-quota-resets-in: seconds until the window resets
	const remainingRaw = res.headers.get('x-toggl-quota-remaining');
	const resetsInRaw  = res.headers.get('x-toggl-quota-resets-in');
	if (remainingRaw !== null && resetsInRaw !== null) {
		const remaining = Number(remainingRaw);
		const resetsIn  = Number(resetsInRaw);
		if (!Number.isNaN(remaining) && !Number.isNaN(resetsIn)) {
			_rateLimitRegistry.set(apiToken, { remaining, resetAt: new Date(Date.now() + resetsIn * 1_000) });
		}
	}

	if (!res.ok) {
		const text = await res.text().catch(() => "");
		throw new Error(`HTTP ${res.status}${text ? `: ${text}` : ""}`);
	}
	if (res.status === 204) return null as T;

	const text = await res.text();
	if (!text) return null as T;
	return JSON.parse(text) as T;
}
