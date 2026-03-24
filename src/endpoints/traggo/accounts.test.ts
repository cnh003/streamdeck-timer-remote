import { describe, it, expect, vi, beforeEach } from "vitest";
import streamDeck from "@elgato/streamdeck";
import { graphql } from "./graphql.js";
import { getAccounts, loginAccount, logoutAccount, updateAccountInterval } from "./accounts.js";

vi.mock("@elgato/streamdeck", () => ({
	default: {
		settings: {
			getGlobalSettings: vi.fn(),
			setGlobalSettings: vi.fn(),
		},
	},
}));

vi.mock("./graphql.js", () => ({
	graphql: vi.fn(),
}));

const mockGetGlobal = vi.mocked(streamDeck.settings.getGlobalSettings);
const mockSetGlobal = vi.mocked(streamDeck.settings.setGlobalSettings);
const mockGraphQL   = vi.mocked(graphql);

beforeEach(() => {
	vi.clearAllMocks();
	mockSetGlobal.mockResolvedValue(undefined as never);
});

// ── getAccounts ───────────────────────────────────────────────────────────────

describe("getAccounts", () => {
	it("returns an empty array when no accounts are stored", async () => {
		mockGetGlobal.mockResolvedValue({});
		expect(await getAccounts()).toEqual([]);
	});

	it("returns an empty array when the accounts key is missing", async () => {
		mockGetGlobal.mockResolvedValue({ accounts: undefined });
		expect(await getAccounts()).toEqual([]);
	});

	it("returns the stored accounts", async () => {
		const accounts = [{ url: "http://traggo", username: "alice", token: "tok", deviceId: 1 }];
		mockGetGlobal.mockResolvedValue({ accounts });
		expect(await getAccounts()).toEqual(accounts);
	});
});

// ── loginAccount ──────────────────────────────────────────────────────────────

describe("loginAccount", () => {
	it("stores the new account and returns the updated list", async () => {
		mockGraphQL.mockResolvedValue({ login: { token: "tok1", device: { id: 42 } } });
		mockGetGlobal.mockResolvedValue({});

		const result = await loginAccount("http://traggo", "alice", "password");

		expect(result).toEqual([
			{ url: "http://traggo", username: "alice", token: "tok1", deviceId: 42, interval: "60" },
		]);
		expect(mockSetGlobal).toHaveBeenCalledWith({
			accounts: [{ url: "http://traggo", username: "alice", token: "tok1", deviceId: 42, interval: "60" }],
		});
	});

	it("appends to existing accounts without touching unrelated ones", async () => {
		const existing = [{ url: "http://other", username: "bob", token: "t2", deviceId: 99 }];
		mockGraphQL.mockResolvedValue({ login: { token: "tok1", device: { id: 42 } } });
		mockGetGlobal.mockResolvedValue({ accounts: existing });

		const result = await loginAccount("http://traggo", "alice", "password");

		expect(result).toHaveLength(2);
		expect(result).toContainEqual({ url: "http://other", username: "bob", token: "t2", deviceId: 99 });
		expect(result).toContainEqual({ url: "http://traggo", username: "alice", token: "tok1", deviceId: 42, interval: "60" });
	});

	it("replaces an existing account with the same URL and username", async () => {
		const existing = [{ url: "http://traggo", username: "alice", token: "old", deviceId: 1 }];
		mockGraphQL.mockResolvedValue({ login: { token: "newtoken", device: { id: 2 } } });
		mockGetGlobal.mockResolvedValue({ accounts: existing });

		const result = await loginAccount("http://traggo", "alice", "password");

		expect(result).toHaveLength(1);
		expect(result[0]).toEqual({ url: "http://traggo", username: "alice", token: "newtoken", deviceId: 2, interval: "60" });
	});

	it("calls the login mutation with the provided credentials", async () => {
		mockGraphQL.mockResolvedValue({ login: { token: "t", device: { id: 1 } } });
		mockGetGlobal.mockResolvedValue({});

		await loginAccount("http://traggo", "alice", "secret");

		expect(mockGraphQL).toHaveBeenCalledOnce();
		const [url, token, query, variables] = mockGraphQL.mock.calls[0];
		expect(url).toBe("http://traggo");
		expect(token).toBeNull();
		expect(query).toContain("login");
		expect(variables).toMatchObject({ u: "alice", p: "secret" });
	});
});

// ── logoutAccount ─────────────────────────────────────────────────────────────

describe("logoutAccount", () => {
	it("removes the account from global settings", async () => {
		const acc = { url: "http://traggo", username: "alice", token: "tok1", deviceId: 42 };
		mockGetGlobal.mockResolvedValue({ accounts: [acc] });
		mockGraphQL.mockResolvedValue({ removeDevice: { id: 42 } });

		const result = await logoutAccount("http://traggo", "alice");

		expect(result).toEqual([]);
		expect(mockSetGlobal).toHaveBeenCalledWith({ accounts: [] });
	});

	it("calls the removeDevice mutation with the account's device ID", async () => {
		const acc = { url: "http://traggo", username: "alice", token: "tok1", deviceId: 42 };
		mockGetGlobal.mockResolvedValue({ accounts: [acc] });
		mockGraphQL.mockResolvedValue({ removeDevice: { id: 42 } });

		await logoutAccount("http://traggo", "alice");

		expect(mockGraphQL).toHaveBeenCalledOnce();
		const [url, token, query, variables] = mockGraphQL.mock.calls[0];
		expect(url).toBe("http://traggo");
		expect(token).toBe("tok1");
		expect(query).toContain("removeDevice");
		expect(variables).toMatchObject({ id: 42 });
	});

	it("still removes the account when the revoke call fails (best-effort)", async () => {
		const acc = { url: "http://traggo", username: "alice", token: "tok1", deviceId: 42 };
		mockGetGlobal.mockResolvedValue({ accounts: [acc] });
		mockGraphQL.mockRejectedValue(new Error("network error"));

		const result = await logoutAccount("http://traggo", "alice");

		expect(result).toEqual([]);
		expect(mockSetGlobal).toHaveBeenCalledWith({ accounts: [] });
	});

	it("only removes the matching account; others remain", async () => {
		const alice = { url: "http://traggo", username: "alice", token: "t1", deviceId: 1 };
		const bob   = { url: "http://traggo", username: "bob",   token: "t2", deviceId: 2 };
		mockGetGlobal.mockResolvedValue({ accounts: [alice, bob] });
		mockGraphQL.mockResolvedValue({});

		const result = await logoutAccount("http://traggo", "alice");

		expect(result).toEqual([bob]);
		expect(mockSetGlobal).toHaveBeenCalledWith({ accounts: [bob] });
	});

	it("does not call the API and returns the list unchanged if account is not found", async () => {
		const bob = { url: "http://traggo", username: "bob", token: "t2", deviceId: 2 };
		mockGetGlobal.mockResolvedValue({ accounts: [bob] });

		const result = await logoutAccount("http://traggo", "alice");

		expect(mockGraphQL).not.toHaveBeenCalled();
		expect(result).toEqual([bob]);
	});
});

// ── updateAccountInterval ─────────────────────────────────────────────────────

describe("updateAccountInterval", () => {
	it("sets the interval on the matching account and persists it", async () => {
		const acc = { url: "http://traggo", username: "alice", token: "tok", deviceId: 1 };
		mockGetGlobal.mockResolvedValue({ accounts: [acc] });

		const result = await updateAccountInterval("http://traggo", "alice", "300");

		expect(result).toEqual([{ ...acc, interval: "300" }]);
		expect(mockSetGlobal).toHaveBeenCalledWith({
			accounts: [{ ...acc, interval: "300" }],
		});
	});

	it("does not touch other accounts", async () => {
		const alice = { url: "http://traggo", username: "alice", token: "t1", deviceId: 1 };
		const bob   = { url: "http://traggo", username: "bob",   token: "t2", deviceId: 2 };
		mockGetGlobal.mockResolvedValue({ accounts: [alice, bob] });

		const result = await updateAccountInterval("http://traggo", "alice", "15");

		expect(result.find(a => a.username === "bob")).toEqual(bob);
		expect(result.find(a => a.username === "alice")).toMatchObject({ interval: "15" });
	});

	it("does nothing and does not persist if the account is not found", async () => {
		const bob = { url: "http://traggo", username: "bob", token: "t2", deviceId: 2 };
		mockGetGlobal.mockResolvedValue({ accounts: [bob] });

		const result = await updateAccountInterval("http://traggo", "alice", "15");

		expect(result).toEqual([bob]);
		expect(mockSetGlobal).not.toHaveBeenCalled();
	});
});
