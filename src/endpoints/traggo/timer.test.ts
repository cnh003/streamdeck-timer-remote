import { describe, it, expect, vi, beforeEach } from "vitest";
import { graphql } from "./graphql.js";
import { getRunningTimer } from "./timer.js";

vi.mock("./graphql.js", () => ({ graphql: vi.fn() }));

const mockGraphQL = vi.mocked(graphql);

beforeEach(() => vi.clearAllMocks());

const TAG_DEFS = [
	{ key: "work",  color: "#ff0000" },
	{ key: "play",  color: "#00ff00" },
];

describe("getRunningTimer", () => {
	it("returns { running: false } when there are no active timers", async () => {
		mockGraphQL.mockResolvedValue({ timers: [], tags: TAG_DEFS });

		expect(await getRunningTimer("http://host", "tok")).toEqual({ running: false });
	});

	it("returns running timer info with the correct id, tagKey, color, and startTime", async () => {
		const start = "2026-03-24T10:00:00.000Z";
		mockGraphQL.mockResolvedValue({
			timers: [{ id: 7, start, note: "doing stuff", tags: [{ key: "work", value: "" }] }],
			tags: TAG_DEFS,
		});

		const result = await getRunningTimer("http://host", "tok");

		expect(result).toMatchObject({
			running:   true,
			id:        7,
			tagKey:    "work",
			color:     "#ff0000",
			startTime: new Date(start),
		});
	});

	it("uses the color from the first matching tag definition", async () => {
		const start = "2026-03-24T10:00:00.000Z";
		mockGraphQL.mockResolvedValue({
			timers: [{ id: 3, start, note: "", tags: [{ key: "play", value: "" }] }],
			tags: TAG_DEFS,
		});

		const result = await getRunningTimer("http://host", "tok");

		expect(result).toMatchObject({ running: true, tagKey: "play", color: "#00ff00" });
	});

	it("falls back to #333333 when the timer's tag key has no matching definition", async () => {
		const start = "2026-03-24T10:00:00.000Z";
		mockGraphQL.mockResolvedValue({
			timers: [{ id: 1, start, note: "", tags: [{ key: "unknown", value: "" }] }],
			tags: TAG_DEFS,
		});

		const result = await getRunningTimer("http://host", "tok");

		expect(result).toMatchObject({ running: true, tagKey: "unknown", color: "#333333" });
	});

	it("returns tagKey null and #333333 color when the timer has no tags", async () => {
		const start = "2026-03-24T10:00:00.000Z";
		mockGraphQL.mockResolvedValue({
			timers: [{ id: 2, start, note: "", tags: [] }],
			tags: TAG_DEFS,
		});

		const result = await getRunningTimer("http://host", "tok");

		expect(result).toMatchObject({ running: true, tagKey: null, color: "#333333" });
	});

	it("parses the start time string into a Date object", async () => {
		const start = "2026-01-15T08:30:00.000Z";
		mockGraphQL.mockResolvedValue({
			timers: [{ id: 5, start, note: "", tags: [] }],
			tags: [],
		});

		const result = await getRunningTimer("http://host", "tok");

		if (result.running) {
			expect(result.startTime).toBeInstanceOf(Date);
			expect(result.startTime.toISOString()).toBe(start);
		}
	});
});
