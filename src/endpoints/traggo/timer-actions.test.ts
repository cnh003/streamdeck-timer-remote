import { describe, it, expect, vi, beforeEach } from "vitest";
import { graphql } from "./graphql.js";
import { startTimer, stopTimer } from "./timer-actions.js";

vi.mock("./graphql.js", () => ({ graphql: vi.fn() }));

const mockGraphQL = vi.mocked(graphql);

beforeEach(() => {
	vi.clearAllMocks();
	mockGraphQL.mockResolvedValue({});
});

describe("startTimer", () => {
	it("calls graphql with the createTimeSpan mutation", async () => {
		await startTimer("http://host", "tok", "work", "my task");

		expect(mockGraphQL).toHaveBeenCalledOnce();
		const [, , query] = mockGraphQL.mock.calls[0];
		expect(query).toContain("createTimeSpan");
	});

	it("passes the correct URL and token to graphql", async () => {
		await startTimer("http://host", "mytoken", "work", "note");

		const [url, token] = mockGraphQL.mock.calls[0];
		expect(url).toBe("http://host");
		expect(token).toBe("mytoken");
	});

	it("includes the tag key and note in the variables", async () => {
		await startTimer("http://host", "tok", "development", "fixing bugs");

		const variables = mockGraphQL.mock.calls[0][3]!;
		expect(variables).toMatchObject({
			tags: [{ key: "development", value: "" }],
			note: "fixing bugs",
		});
	});

	it("includes a valid ISO start timestamp in the variables", async () => {
		const before = new Date();
		await startTimer("http://host", "tok", "work", "note");
		const after = new Date();

		const variables = mockGraphQL.mock.calls[0][3]!;
		const start = new Date(variables.start as string);
		expect(start.getTime()).toBeGreaterThanOrEqual(before.getTime());
		expect(start.getTime()).toBeLessThanOrEqual(after.getTime());
	});
});

describe("stopTimer", () => {
	it("calls graphql with the stopTimeSpan mutation", async () => {
		await stopTimer("http://host", "tok", 99);

		expect(mockGraphQL).toHaveBeenCalledOnce();
		const [, , query] = mockGraphQL.mock.calls[0];
		expect(query).toContain("stopTimeSpan");
	});

	it("passes the correct URL and token to graphql", async () => {
		await stopTimer("http://host", "mytoken", 1);

		const [url, token] = mockGraphQL.mock.calls[0];
		expect(url).toBe("http://host");
		expect(token).toBe("mytoken");
	});

	it("passes the timer ID in the variables", async () => {
		await stopTimer("http://host", "tok", 42);

		const variables = mockGraphQL.mock.calls[0][3]!;
		expect(variables).toMatchObject({ id: 42 });
	});

	it("includes a valid ISO end timestamp in the variables", async () => {
		const before = new Date();
		await stopTimer("http://host", "tok", 1);
		const after = new Date();

		const variables = mockGraphQL.mock.calls[0][3]!;
		const end = new Date(variables.end as string);
		expect(end.getTime()).toBeGreaterThanOrEqual(before.getTime());
		expect(end.getTime()).toBeLessThanOrEqual(after.getTime());
	});
});
