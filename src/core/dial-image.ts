import { TimerState, ICON_IDLE, ICON_RUNNING, ICON_OTHER, ICON_WARNING } from "./icons.js";
import type { BusStats } from "./types.js";

/**
 * Builds the 200×100 touch-canvas image for the Stream Deck+ encoder dial
 * as a base-64 data URI SVG.
 *
 * Geometry mirrors the built-in $A1 layout exactly:
 *   title : rect [16, 10, 136, 24]  — font 16 600, left-aligned
 *   icon  : rect [16, 40,  48, 48]  — translate(16,40) scale(2) from 24×24
 *   value : rect [76, 40, 108, 32]  — font 24 600, middle at x=125
 *
 * state='running' → solid colour fill rectangle
 * state='idle'|'other' → colour stroke rectangle only
 *
 * @param state     Visual state — idle / running / other
 * @param tagKey    Tag label (null → "---")
 * @param tagColor  Hex colour for the tag accent (fallback #888888)
 * @param elapsed   Elapsed string when running (null → "--:--")
 */
export function buildDialImage(
	state: TimerState,
	tagKey: string | null,
	tagColor: string,
	elapsed: string | null,
): string {
	let iconContent: string;
	if (state === 'running')      { iconContent = ICON_RUNNING; }
	else if (state === 'other')   { iconContent = ICON_OTHER; }
	else if (state === 'warning') { iconContent = ICON_WARNING; }
	else                          { iconContent = ICON_IDLE; }

	const color = /^#[0-9a-fA-F]{3,8}$/.test(tagColor) ? tagColor : "#888888";

	const container = state === 'running'
		? `<rect x="3" y="3" width="194" height="94" rx="10" fill="${color}"/>`
		: `<rect x="3" y="3" width="194" height="94" rx="10" fill="none" stroke="${color}" stroke-width="3"/>`;

	const icon    = `<g transform="translate(20,38) scale(2)" fill="#ffffff">${iconContent}</g>`;
	const title   = `<text x="16" y="28" dominant-baseline="middle" text-anchor="start" font-family="sans-serif" font-size="16" font-weight="600" fill="#ffffff">${escXml(tagKey ?? "---")}</text>`;
	const elapsed_ = `<text x="125" y="70" dominant-baseline="middle" text-anchor="middle" font-family="sans-serif" font-size="24" font-weight="600" fill="#ffffff">${escXml(elapsed ?? "--:--")}</text>`;

	const svg =
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100" width="200" height="100">`
		+ `<rect width="200" height="100" fill="#000000"/>`
		+ container
		+ icon
		+ title
		+ elapsed_
		+ `</svg>`;

	return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function escXml(s: string): string {
	return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/**
 * Builds a 200×100 rate-limit error image for the dial canvas.
 * Shows "API limit reached" and a countdown until the window resets.
 */
export function buildRateLimitDialImage(countdown: string): string {
	const svg =
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100" width="200" height="100">`
		+ `<rect width="200" height="100" fill="#1a0000"/>`
		+ `<rect x="3" y="3" width="194" height="94" rx="10" fill="none" stroke="#e04040" stroke-width="3"/>`
		+ `<g transform="translate(20,38) scale(2)" fill="#e04040">${ICON_WARNING}</g>`
		+ `<text x="16" y="28" dominant-baseline="middle" text-anchor="start" font-family="sans-serif" font-size="14" font-weight="600" fill="#e04040">API limit reached</text>`
		+ `<text x="125" y="70" dominant-baseline="middle" text-anchor="middle" font-family="sans-serif" font-size="24" font-weight="600" fill="#e04040">${escXml(countdown)}</text>`
		+ `</svg>`;
	return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function trunc(s: string, max: number): string {
	return s.length <= max ? s : `${s.slice(0, max - 1)}\u2026`;
}

function fmtNext(ms: number): string {
	if (ms < 60_000) return `${Math.ceil(ms / 1_000)}s`;
	const m = Math.floor(ms / 60_000);
	const s = Math.ceil((ms % 60_000) / 1_000);
	return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

/** Returns the API quota string for the debug overlay line. */
function apiLine(stats: BusStats): string {
	if (stats.rateLimitRemaining === null) return 'no limit';
	const resetStr = stats.rateLimitReset
		? stats.rateLimitReset.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
		: '?';
	return `${stats.rateLimitRemaining} left (↺${resetStr})`;
}

/**
 * Builds the debug overlay image for the dial — compact stats view.
 * Same 200×100 canvas as buildDialImage.
 */
export function buildDebugImage(stats: BusStats, activeTagLabel: string | null): string {
	const tag     = activeTagLabel ? trunc(activeTagLabel, 28) : '\u2014';
	const nextStr = stats.nextPollInMs !== null ? fmtNext(stats.nextPollInMs) : '\u2014';
	const lastStr = stats.lastPollTime
		? stats.lastPollTime.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
		: '\u2014';
	const okStr   = stats.lastPollOk === null ? '' : stats.lastPollOk ? ' ok' : ' ERR';
	const okColor = stats.lastPollOk === false ? '#e04040' : '#80c080';

	const rows: Array<{ text: string; color: string; size: number }> = [
		{ text: trunc(stats.accountLabel, 26),                            color: '#d8d8d8', size: 12 },
		{ text: trunc(`${stats.service}: ${stats.serviceDetail}`, 30),    color: '#888888', size: 11  },
		{ text: tag,                                                       color: '#aaaaaa', size: 11  },
		{ text: `API: ${apiLine(stats)} | next: ${nextStr}`,              color: '#777777', size: 11  },
		{ text: `Last: ${lastStr}`,                                        color: stats.lastPollOk === false ? '#e04040' : '#777777', size: 11 },
	];

	// y positions for 5 lines; a subtle horizontal rule separates meta from stats
	const ys = [12, 24, 36, 54, 67];

	const textEls = rows.map((r, i) =>
		`<text x="5" y="${ys[i]}" dominant-baseline="middle" text-anchor="start" font-family="sans-serif" font-size="${r.size}" fill="${r.color}">${escXml(r.text)}</text>`
	).join('');

	// Status badge at end of the last line
	const statusEl = stats.lastPollOk !== null
		? `<text x="195" y="${ys[4]}" dominant-baseline="middle" text-anchor="end" font-family="sans-serif" font-size="9" fill="${okColor}">${escXml(okStr.trim())}</text>`
		: '';

	const divider = `<line x1="5" y1="45" x2="195" y2="45" stroke="#333333" stroke-width="1"/>`;
	const badge   = `<text x="195" y="7" dominant-baseline="auto" text-anchor="end" font-family="sans-serif" font-size="7" fill="#444444">DBG</text>`;

	const svg =
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100" width="200" height="100">`
		+ `<rect width="200" height="100" fill="#05080f"/>`
		+ badge + divider + textEls + statusEl
		+ `</svg>`;

	return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}
