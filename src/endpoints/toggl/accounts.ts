import streamDeck from "@elgato/streamdeck";
import { togglFetch } from "./toggl-api.js";

/** A logged-in Toggl Track account persisted in plugin-global settings. */
export type TogglAccount = {
	displayName: string;
	email: string;
	apiToken: string;
	workspaceId: number;
	workspaceName: string;
	/** Polling interval in seconds (stored as string). Defaults to "60". */
	interval?: string;
};

/** Returns the unique account key for a Toggl account. */
export function togglAccountKey(account: Pick<TogglAccount, "workspaceId" | "email">): string {
	return `toggl||${account.workspaceId}||${account.email}`;
}

/** Returns all stored Toggl accounts. */
export async function getTogglAccounts(): Promise<TogglAccount[]> {
	const gs = await streamDeck.settings.getGlobalSettings<{ togglAccounts?: TogglAccount[] }>();
	return gs?.togglAccounts ?? [];
}

async function saveTogglAccounts(accounts: TogglAccount[]): Promise<void> {
	const gs = await streamDeck.settings.getGlobalSettings<{ togglAccounts?: TogglAccount[] }>() ?? {};
	await streamDeck.settings.setGlobalSettings({ ...gs, togglAccounts: accounts });
}

/** Fetches all workspaces the token owner belongs to. */
export async function fetchWorkspaces(apiToken: string): Promise<Array<{ id: number; name: string }>> {
	return togglFetch<Array<{ id: number; name: string }>>("/workspaces", apiToken);
}

/**
 * Validates the API token (by fetching the user's profile), persists the
 * account in global settings, and returns the newly stored account object.
 * If an account for the same email+workspace already exists it is replaced.
 */
export async function addTogglAccount(
	apiToken: string,
	workspaceId: number,
	workspaceName: string,
	interval: string,
): Promise<TogglAccount> {
	const me = await togglFetch<{ email: string; fullname: string }>("/me", apiToken);

	const account: TogglAccount = {
		displayName: me.fullname,
		email: me.email,
		apiToken,
		workspaceId,
		workspaceName,
		interval: interval ?? '300',
	};

	const accounts = await getTogglAccounts();
	const idx = accounts.findIndex(a => a.email === me.email && a.workspaceId === workspaceId);
	if (idx >= 0) accounts[idx] = account;
	else accounts.push(account);

	await saveTogglAccounts(accounts);
	return account;
}

/** Removes a Toggl account from global settings and returns the updated list. */
export async function removeTogglAccount(email: string, workspaceId: number): Promise<TogglAccount[]> {
	const accounts = await getTogglAccounts();
	const updated = accounts.filter(a => !(a.email === email && a.workspaceId === workspaceId));
	await saveTogglAccounts(updated);
	return updated;
}

/** Updates the polling interval for an existing Toggl account. */
export async function updateTogglAccountInterval(
	email: string,
	workspaceId: number,
	interval: string,
): Promise<TogglAccount[]> {
	const accounts = await getTogglAccounts();
	const idx = accounts.findIndex(a => a.email === email && a.workspaceId === workspaceId);
	if (idx >= 0) accounts[idx] = { ...accounts[idx], interval };
	await saveTogglAccounts(accounts);
	return accounts;
}
