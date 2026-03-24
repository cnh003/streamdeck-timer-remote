import { togglFetch } from "./toggl-api.js";
import type { TagDefinition, TimerInfo } from "../../core/types.js";

type TogglEntry = {
	id: number;
	workspace_id: number;
	description: string | null;
	tags: string[] | null;
	project_id: number | null;
	start: string;
	/** Negative value means the timer is currently running. */
	duration: number;
};

/**
 * Fetches the currently running time entry from Toggl.
 * Returns null when no timer is running or the entry belongs to a stopped span.
 */
export async function fetchCurrentEntry(apiToken: string): Promise<TogglEntry | null> {
	const entry = await togglFetch<TogglEntry | null>("/me/time_entries/current", apiToken);
	if (!entry || entry.duration >= 0) return null;
	return entry;
}

/**
 * Converts a raw Toggl entry (or null) into the backend-agnostic TimerInfo.
 * Accepts the already-fetched tag list so no extra API call is required.
 */
export function buildTimerInfo(entry: TogglEntry | null, tags: TagDefinition[]): TimerInfo {
	if (!entry) return { running: false };
	const tagKey = entry.project_id !== null ? String(entry.project_id) : null;
	const color = tagKey
		? (tags.find(t => t.key === tagKey)?.color ?? "#333333")
		: "#333333";
	return {
		running: true,
		id: entry.id,
		tagKey,
		color,
		startTime: new Date(entry.start),
	};
}
