import streamDeck from "@elgato/streamdeck";
import type { JsonValue } from "@elgato/utils";
import type { IAccountBus } from "./core/account-bus.js";

import { TimerToggle } from "./actions/timer-toggle.js";
import { TimerDial } from "./actions/timer-dial.js";

// ── Traggo ───────────────────────────────────────────────────────────────────
import { getBus as getTraggooBus } from "./endpoints/traggo/traggo-bus.js";
import { getAccounts as getTraggoAccounts, loginAccount, logoutAccount, updateAccountInterval } from "./endpoints/traggo/accounts.js";
import { fetchTags as fetchTraggoTags } from "./endpoints/traggo/tags.js";

// ── Toggl ────────────────────────────────────────────────────────────────────
import { getBus as getTogglBus } from "./endpoints/toggl/toggl-bus.js";
import { getTogglAccounts, addTogglAccount, removeTogglAccount, updateTogglAccountInterval, fetchWorkspaces, togglAccountKey } from "./endpoints/toggl/accounts.js";
import { fetchTags as fetchTogglTags } from "./endpoints/toggl/tags.js";

streamDeck.logger.setLevel("warn");

// ── Account key routing ──────────────────────────────────────────────────────

function getBus(accountKey: string): IAccountBus {
	return accountKey.startsWith("toggl||") ? getTogglBus(accountKey) : getTraggooBus(accountKey);
}

/** Decomposes a Toggl key ("toggl||{wid}||{email}") into its parts. */
function parseTogglKey(key: string): { workspaceId: number; email: string } {
	const first = key.indexOf("||");
	const second = key.indexOf("||", first + 2);
	return {
		workspaceId: Number(key.slice(first + 2, second)),
		email: key.slice(second + 2),
	};
}

function formatUrl(url: string): string {
	url = url.trim();
	if (!/^https?:\/\//i.test(url)) url = "https://" + url;
	return url;
}

function safeHostname(url: string): string {
	try { return new URL(url).hostname; } catch { return url; }
}

// ── Unified accounts list ────────────────────────────────────────────────────

type AccountSummary = {
	key: string;
	label: string;
	backend: "traggo" | "toggl";
	interval: string;
	// Traggo-only (used by the edit form and fetchTags routing)
	url?: string;
	username?: string;
};

async function buildAccountSummaries(): Promise<AccountSummary[]> {
	const [traggoAccounts, togglAccounts] = await Promise.all([
		getTraggoAccounts(),
		getTogglAccounts(),
	]);
	return [
		...traggoAccounts.map(a => ({
			key:      `${a.url}||${a.username}||${a.deviceId}`,
			label:    `${a.username} @ ${safeHostname(a.url)}`,
			backend:  "traggo" as const,
			interval: a.interval ?? "60",
			url:      a.url,
			username: a.username,
		})),
		...togglAccounts.map(a => ({
			key:      togglAccountKey(a),
			label:    `${a.displayName} @ Toggl`,
			backend:  "toggl" as const,
			interval: a.interval ?? "60",
		})),
	];
}

async function sendAccountsResult(): Promise<void> {
	const accounts = await buildAccountSummaries();
	await streamDeck.ui.sendToPropertyInspector({ type: "accountsResult", accounts });
}

// ── Unified PI message handler ───────────────────────────────────────────────

async function handlePI(payload: JsonValue): Promise<void> {
	const msg = payload as { type: string } & Record<string, unknown>;

	switch (msg.type) {
		// ── Shared ──────────────────────────────────────────────────────────
		case "getAccounts":
			await sendAccountsResult();
			return;

		case "removeAccount": {
			const accountKey = msg.accountKey as string;
			if (accountKey.startsWith("toggl||")) {
				const { workspaceId, email } = parseTogglKey(accountKey);
				await removeTogglAccount(email, workspaceId);
			} else {
				const accounts = await getTraggoAccounts();
				const account = accounts.find(a => `${a.url}||${a.username}||${a.deviceId}` === accountKey);
				if (account) await logoutAccount(account.url, account.username);
			}
			// Revert all visible actions that used the removed account.
			for (const act of streamDeck.actions) {
				const settings = await act.getSettings<{ accountKey?: string }>();
				if (settings.accountKey === accountKey) {
					await act.setSettings({ ...settings, accountKey: undefined });
				}
			}
			await sendAccountsResult();
			return;
		}

		case "updateAccount": {
			const accountKey = msg.accountKey as string;
			const interval   = msg.interval as string;
			if (accountKey.startsWith("toggl||")) {
				const { workspaceId, email } = parseTogglKey(accountKey);
				await updateTogglAccountInterval(email, workspaceId, interval);
			} else {
				const accounts = await getTraggoAccounts();
				const account = accounts.find(a => `${a.url}||${a.username}||${a.deviceId}` === accountKey);
				if (account) await updateAccountInterval(account.url, account.username, interval);
			}
			await sendAccountsResult();
			return;
		}

		case "fetchTags": {
			const accountKey = msg.accountKey as string;
			try {
				if (accountKey.startsWith("toggl||")) {
					const { workspaceId, email } = parseTogglKey(accountKey);
					const togglAccounts = await getTogglAccounts();
					const account = togglAccounts.find(a => a.email === email && a.workspaceId === workspaceId);
					if (!account) throw new Error("Account not found");
					const tags = await fetchTogglTags(account.apiToken, account.workspaceId);
					await streamDeck.ui.sendToPropertyInspector({ type: "tagsResult", tags });
				} else {
					const accounts = await getTraggoAccounts();
					const account = accounts.find(a => `${a.url}||${a.username}||${a.deviceId}` === accountKey);
					if (!account) throw new Error("Account not found");
					const tags = await fetchTraggoTags(account.url, account.token);
					await streamDeck.ui.sendToPropertyInspector({ type: "tagsResult", tags });
				}
			} catch (err) {
				await streamDeck.ui.sendToPropertyInspector({ type: "tagsResult", error: String(err) });
			}
			return;
		}

		// ── Traggo ──────────────────────────────────────────────────────────
		case "login": {
			try {
				await loginAccount(
					msg.url as string,
					msg.username as string,
					msg.password as string,
					msg.interval as string | undefined,
				);
				const accounts = await buildAccountSummaries();
				const formattedUrl = formatUrl(msg.url as string);
				const newKey = accounts.find(
					a => a.backend === "traggo" && a.url === formattedUrl && a.username === msg.username
				)?.key ?? null;
				await streamDeck.ui.sendToPropertyInspector({ type: "loginResult", accounts, newAccountKey: newKey });
			} catch (err) {
				await streamDeck.ui.sendToPropertyInspector({ type: "loginResult", error: String(err) });
			}
			return;
		}

		// ── Toggl ────────────────────────────────────────────────────────────
		case "fetchTogglWorkspaces": {
			try {
				const workspaces = await fetchWorkspaces(msg.apiToken as string);
				await streamDeck.ui.sendToPropertyInspector({ type: "togglWorkspacesResult", workspaces });
			} catch (err) {
				await streamDeck.ui.sendToPropertyInspector({ type: "togglWorkspacesResult", error: String(err) });
			}
			return;
		}

		case "loginToggl": {
			try {
				const account = await addTogglAccount(
					msg.apiToken as string,
					msg.workspaceId as number,
					msg.workspaceName as string,
					msg.interval as string,
				);
				const newKey   = togglAccountKey(account);
				const accounts = await buildAccountSummaries();
				await streamDeck.ui.sendToPropertyInspector({ type: "loginResult", accounts, newAccountKey: newKey });
			} catch (err) {
				await streamDeck.ui.sendToPropertyInspector({ type: "loginResult", error: String(err) });
			}
			return;
		}
	}
}

// ── Register actions ─────────────────────────────────────────────────────────

streamDeck.actions.registerAction(new TimerToggle(getBus, handlePI));
streamDeck.actions.registerAction(new TimerDial(getBus, handlePI));

// Finally, connect to the Stream Deck.
streamDeck.connect();

