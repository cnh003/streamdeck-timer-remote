import { togglFetch } from "./toggl-api.js";
import type { TagDefinition } from "../../core/types.js";

type TogglProject = { id: number; workspace_id: number; name: string; color: string; active: boolean };

/** Fetches all active projects for the given workspace. */
export async function fetchTags(apiToken: string, workspaceId: number): Promise<TagDefinition[]> {
	const projects = await togglFetch<TogglProject[]>(`/workspaces/${workspaceId}/projects`, apiToken);
	return (projects ?? [])
		.filter(p => p.active)
		.map(p => ({ key: String(p.id), color: p.color || "#333333", label: p.name }));
}
