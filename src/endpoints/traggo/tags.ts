import { graphql } from "./graphql.js";
import type { TagDefinition } from "../../core/types.js";

export type { TagDefinition } from "../../core/types.js";

/** Fetches all tag definitions from the Traggo server. */
export async function fetchTags(url: string, token: string): Promise<TagDefinition[]> {
	const data = await graphql(url, token, `query { tags { key color } }`) as { tags: TagDefinition[] };
	return data.tags;
}
