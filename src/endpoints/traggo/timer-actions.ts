import { graphql } from "./graphql.js";

/**
 * Starts a new running timer (timespan with no end) for the given tag and note.
 * Uses the Traggo `createTimespan` mutation.
 */
export async function startTimer(
	url: string,
	token: string,
	tagKey: string,
	notes: string,
): Promise<void> {
	const start = new Date().toISOString();
	await graphql(url, token,
		`mutation StartTimer($start: Time!, $tags: [InputTimeSpanTag!]!, $note: String!) {
			createTimeSpan(start: $start, tags: $tags, note: $note) { id }
		}`,
		{ start, tags: [{ key: tagKey, value: "" }], note: notes },
	);
}

/**
 * Stops a running timer by setting its end time to now.
 * Uses the dedicated `stopTimeSpan` mutation — only requires id and end.
 */
export async function stopTimer(
	url: string,
	token: string,
	id: number,
): Promise<void> {
	const end = new Date().toISOString();
	await graphql(url, token,
		`mutation StopTimer($id: Int!, $end: Time!) {
			stopTimeSpan(id: $id, end: $end) { id }
		}`,
		{ id, end },
	);
}
