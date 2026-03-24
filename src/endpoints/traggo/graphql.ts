/**
 * Generic GraphQL helper for the Traggo server.
 * No SDK or core imports — pure HTTP.
 */
export async function graphql(
	url: string,
	token: string | null,
	query: string,
	variables: Record<string, unknown> = {}
): Promise<unknown> {
	const headers: Record<string, string> = { "Content-Type": "application/json" };
	if (token) headers["Authorization"] = `traggo ${token}`;

	const res = await fetch(`${url.replace(/\/$/, "")}/graphql`, {
		method: "POST",
		headers,
		body: JSON.stringify({ query, variables }),
	});

	if (!res.ok) throw new Error(`HTTP ${res.status}`);

	const json = await res.json() as { data?: unknown; errors?: { message: string }[] };
	if (json.errors?.length) {
		throw new Error(json.errors.map(e => e.message).join(" | "));
	}
	return json.data;
}
