import { describe, it, expect, vi, beforeEach } from "vitest";
import { graphql } from "./graphql.js";
import { fetchTags } from "./tags.js";

vi.mock("./graphql.js", () => ({ graphql: vi.fn() }));

const mockGraphQL = vi.mocked(graphql);

beforeEach(() => vi.clearAllMocks());

describe("fetchTags", () => {
	it("returns the tags array from the server", async () => {
		const tags = [
			{ key: "work",     color: "#ff0000" },
			{ key: "personal", color: "#0000ff" },
		];
		mockGraphQL.mockResolvedValue({ tags });

		expect(await fetchTags("http://host", "tok")).toEqual(tags);
	});

	it("returns an empty array when no tags are defined", async () => {
		mockGraphQL.mockResolvedValue({ tags: [] });

		expect(await fetchTags("http://host", "tok")).toEqual([]);
	});

	it("passes the correct URL and token to graphql", async () => {
		mockGraphQL.mockResolvedValue({ tags: [] });

		await fetchTags("http://host", "mytoken");

		const [url, token] = mockGraphQL.mock.calls[0];
		expect(url).toBe("http://host");
		expect(token).toBe("mytoken");
	});

	it("queries the tags key and color fields", async () => {
		mockGraphQL.mockResolvedValue({ tags: [] });

		await fetchTags("http://host", "tok");

		const [, , query] = mockGraphQL.mock.calls[0];
		expect(query).toContain("tags");
		expect(query).toContain("key");
		expect(query).toContain("color");
	});
});
