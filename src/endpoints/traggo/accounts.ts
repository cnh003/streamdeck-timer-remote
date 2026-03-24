import streamDeck from "@elgato/streamdeck";
import { graphql } from "./graphql.js";

/** A logged-in Traggo account persisted in plugin-global settings. */
export type Account = {
	url: string;
	username: string;
	token: string;
	/** Device ID returned by Traggo on login — used to revoke the token on logout. */
	deviceId: number;
	/** Polling interval in seconds (stored as string). Defaults to "60". */
	interval?: string;
};

type GlobalSettings = { accounts?: Account[] };

/** Returns all stored accounts. */
export async function getAccounts(): Promise<Account[]> {
	const gs = await streamDeck.settings.getGlobalSettings<GlobalSettings>();
	return gs?.accounts ?? [];
}

/** Formats a URL to ensure it has a protocol and no trailing slash. */
function formatUrl(url: string): string {
	url = url.trim();
	if (!/^https?:\/\//i.test(url)) {
		url = "https://" + url;
	}
	return url;
}

/**
 * Authenticates against the Traggo server with a long-lived (NoExpiry) device
 * token, persists the account in global settings, and returns the updated list.
 * If an account for the same url+username already exists it is replaced.
 */
export async function loginAccount(
	url: string,
	username: string,
	password: string,
	interval?: string
): Promise<Account[]> {
	url = formatUrl(url);

	const data = await graphql(
		url, null,
		`mutation Login($u: String!, $p: String!, $d: String!, $t: DeviceType!, $c: Boolean!) {
			login(username: $u, pass: $p, deviceName: $d, type: $t, cookie: $c) {
				token
				device { id }
			}
		}`,
		{ u: username, p: password, d: "StreamDeck", t: "LongExpiry", c: false }
	) as { login: { token: string; device: { id: number } } };

	const account: Account = {
		url,
		username,
		token: data.login.token,
		deviceId: data.login.device.id,
		interval: interval ?? '60',
	};

	const accounts = await getAccounts();
	const idx = accounts.findIndex(a => a.url === url && a.username === username);
	if (idx >= 0) accounts[idx] = account;
	else accounts.push(account);

	const gs = await streamDeck.settings.getGlobalSettings<GlobalSettings>() ?? {};
	await streamDeck.settings.setGlobalSettings<GlobalSettings>({ ...gs, accounts });
	return accounts;
}

/**
 * Revokes the device token on the Traggo server (best-effort) and removes the
 * account from global settings, returning the updated list.
 */
export async function logoutAccount(url: string, username: string): Promise<Account[]> {
	const accounts = await getAccounts();
	const account = accounts.find(a => a.url === url && a.username === username);

	if (account) {
		try {
			await graphql(
				url, account.token,
				`mutation RemoveDevice($id: Int!) { removeDevice(id: $id) { id } }`,
				{ id: account.deviceId }
			);
		} catch {
			// Best-effort — token may already be expired or device removed manually.
		}
	}

	const updated = accounts.filter(a => !(a.url === url && a.username === username));
	const gs = await streamDeck.settings.getGlobalSettings<GlobalSettings>() ?? {};
	await streamDeck.settings.setGlobalSettings<GlobalSettings>({ ...gs, accounts: updated });
	return updated;
}

/** Updates the polling interval for an existing account and persists the change. */
export async function updateAccountInterval(url: string, username: string, interval: string): Promise<Account[]> {
	const accounts = await getAccounts();
	const account = accounts.find(a => a.url === url && a.username === username);
	if (account) {
		account.interval = interval;
		const gs = await streamDeck.settings.getGlobalSettings<GlobalSettings>() ?? {};
		await streamDeck.settings.setGlobalSettings<GlobalSettings>({ ...gs, accounts });
	}
	return accounts;
}
