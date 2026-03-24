import { graphql } from "./graphql.js";
import type { TimerInfo } from "../../core/types.js";

type RawTimer = {
	id: number;
	start: string;
	note: string;
	tags: Array<{ key: string; value: string }>;
};

type TagDef = { key: string; color: string };

export type { TimerInfo } from "../../core/types.js";

/**
 * Queries the Traggo server for the currently running timer.
 * `timers` returns only active (no-end) timers directly — no date range needed.
 * Tag colors are fetched in the same round trip via the top-level `tags` query.
 */
export async function getRunningTimer(url: string, token: string): Promise<TimerInfo> {
	const data = await graphql(
		url, token,
		`query {
			timers { id start note tags { key value } }
			tags { key color }
		}`
	) as { timers: RawTimer[]; tags: TagDef[] };

	const running = data.timers[0] ?? null;
	if (!running) return { running: false };

	const tagKey = running.tags[0]?.key ?? null;
	const color = tagKey
		? (data.tags.find(t => t.key === tagKey)?.color ?? "#333333")
		: "#333333";

	return {
		running: true,
		id: running.id,
		tagKey,
		color,
		startTime: new Date(running.start),
	};
}
