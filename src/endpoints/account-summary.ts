import { getAccounts } from "./traggo/accounts.js";
import { getTogglAccounts, togglAccountKey } from "./toggl/accounts.js";

/**
 * Returns true when the given accountKey corresponds to a currently stored
 * account (Traggo or Toggl).  Used by actions to clear stale settings.
 */
export async function isValidAccountKey(key: string): Promise<boolean> {
	if (key.startsWith("toggl||")) {
		const accounts = await getTogglAccounts();
		return accounts.some(a => togglAccountKey(a) === key);
	}
	const accounts = await getAccounts();
	return accounts.some(a => `${a.url}||${a.username}||${a.deviceId}` === key);
}
