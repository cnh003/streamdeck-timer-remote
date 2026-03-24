import { describe, it, expect, vi, beforeEach } from "vitest";
import { graphql } from "./graphql.js";

// ── Fetch mock ─────────────────────────────────────────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function mockOkJson(body: object) {
	return Promise.resolve({
		ok: true,
		status: 200,
		json: () => Promise.resolve(body),
	});
}

function mockHttpError(status: number) {
	return Promise.resolve({
		ok: false,
		status,
		json: () => Promise.resolve({}),
	});
}

beforeEach(() => {
	vi.clearAllMocks();
});

// ── Tests ──────────────────────────────────────────────────────────────────

describe("graphql", () => {
	it("returns the data property on a successful response", async () => {
		mockFetch.mockReturnValue(mockOkJson({ data: { foo: "bar" } }));

		const result = await graphql("http://host", "tok", "query { foo }");

		expect(result).toEqual({ foo: "bar" });
	});

	it("sends Content-Type and Authorization headers when a token is provided", async () => {
		mockFetch.mockReturnValue(mockOkJson({ data: {} }));

		await graphql("http://host", "mytoken", "query { ping }");

		const headers = mockFetch.mock.calls[0][1].headers as Record<string, string>;
		expect(headers["Content-Type"]).toBe("application/json");
		expect(headers["Authorization"]).toBe("traggo mytoken");
	});

	it("omits the Authorization header when token is null", async () => {
		mockFetch.mockReturnValue(mockOkJson({ data: {} }));

		await graphql("http://host", null, "query { ping }");

		const headers = mockFetch.mock.calls[0][1].headers as Record<string, string>;
		expect(headers["Authorization"]).toBeUndefined();
	});

	it("strips a trailing slash from the URL before appending /graphql", async () => {
		mockFetch.mockReturnValue(mockOkJson({ data: {} }));

		await graphql("http://host/", null, "query { ping }");

		expect(mockFetch.mock.calls[0][0]).toBe("http://host/graphql");
	});

	it("sends the query and variables as a JSON body", async () => {
		mockFetch.mockReturnValue(mockOkJson({ data: {} }));

		await graphql("http://host", null, "query { ping }", { key: "val" });

		const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
		expect(body).toEqual({ query: "query { ping }", variables: { key: "val" } });
	});

	it("uses an empty object for variables when none are provided", async () => {
		mockFetch.mockReturnValue(mockOkJson({ data: {} }));

		await graphql("http://host", null, "query { ping }");

		const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
		expect(body.variables).toEqual({});
	});

	it("throws on a non-2xx HTTP status", async () => {
		mockFetch.mockReturnValue(mockHttpError(500));

		await expect(graphql("http://host", null, "query { x }")).rejects.toThrow("HTTP 500");
	});

	it("throws on a 401 Unauthorized response", async () => {
		mockFetch.mockReturnValue(mockHttpError(401));

		await expect(graphql("http://host", "badtoken", "query { x }")).rejects.toThrow("HTTP 401");
	});

	it("throws when the response contains GraphQL errors, joining messages", async () => {
		mockFetch.mockReturnValue(
			mockOkJson({
				data: null,
				errors: [{ message: "Not found" }, { message: "Access denied" }],
			})
		);

		await expect(graphql("http://host", null, "query { x }")).rejects.toThrow(
			"Not found | Access denied"
		);
	});

	it("throws when the response contains a single GraphQL error", async () => {
		mockFetch.mockReturnValue(
			mockOkJson({ data: null, errors: [{ message: "Something went wrong" }] })
		);

		await expect(graphql("http://host", null, "query { x }")).rejects.toThrow(
			"Something went wrong"
		);
	});
});
