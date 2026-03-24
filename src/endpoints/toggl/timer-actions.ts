import { togglFetch } from "./toggl-api.js";

/** Starts a new running time entry for the given tag in the specified workspace. */
export async function startTimer(
	apiToken: string,
	workspaceId: number,
	tagKey: string,
	description: string,
): Promise<void> {
	await togglFetch<unknown>(`/workspaces/${workspaceId}/time_entries`, apiToken, {
		method: "POST",
		body: JSON.stringify({
			created_with: "StreamDeck",
			description: description || "",
			project_id: Number(tagKey),
			workspace_id: workspaceId,
			start: new Date().toISOString(),
			duration: -1,
		}),
	});
}

/** Stops the running time entry with the given id in the specified workspace. */
export async function stopTimer(
	apiToken: string,
	workspaceId: number,
	id: number,
): Promise<void> {
	await togglFetch<unknown>(`/workspaces/${workspaceId}/time_entries/${id}/stop`, apiToken, {
		method: "PATCH",
	});
}
