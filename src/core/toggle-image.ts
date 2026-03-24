import { TimerState, ICON_IDLE, ICON_RUNNING, ICON_OTHER, ICON_WARNING } from "./icons.js";

/**
 * Builds the 144×144 key-button image as a base-64 data URI SVG.
 *
 * Canvas: viewBox 0 0 100 100, rendered at 144×144 px.
 * Layout:
 *   y=15   — tag name text (font-size 13, bold, centred)
 *   icon   — 48×48 units (24×24 viewBox × scale 2), translate(26,22)
 *   y=92   — elapsed text (font-size 13, bold, centred)
 *
 * @param state    Visual state — idle / running / other
 * @param bgColor  Background fill (hex).  Defaults to black.
 * @param tagName  Optional tag label drawn above the icon.
 * @param elapsed  Optional elapsed string drawn below the icon (only when running).
 */
export function buildImage(
	state: TimerState,
	bgColor = "#000000",
	tagName?: string | null,
	elapsed?: string | null,
): string {
	let iconContent: string;
	if (state === 'running')      { iconContent = ICON_RUNNING; }
	else if (state === 'other')   { iconContent = ICON_OTHER; }
	else if (state === 'warning') { iconContent = ICON_WARNING; }
	else                          { iconContent = ICON_IDLE; }

	const tagText = tagName
		? `<text x="50" y="16" font-family="sans-serif" font-size="13" font-weight="bold" fill="#ffffff" text-anchor="middle">${escXml(tagName)}</text>`
		: "";

	const elapsedText = ((state === 'running' || state === 'warning') && elapsed)
		? `<text x="50" y="92" font-family="sans-serif" font-size="13" font-weight="bold" fill="#ffffff" text-anchor="middle">${escXml(elapsed)}</text>`
		: `<text x="50" y="92" font-family="sans-serif" font-size="13" font-weight="bold" fill="#ffffff" text-anchor="middle">--:--</text>`;

	// Icon 56x56 units (24×24 viewBox × scale 2.33), centred in 100×100 canvas.
	// horizontal: (100-56)/2 = 22,  vertical: nudge to 22 to balance text rows
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="144" height="144">`
		+ `<rect width="100" height="100" rx="20" fill="${bgColor}"/>`
		+ tagText
		+ `<g transform="translate(22,23) scale(2.33)" fill="#ffffff">${iconContent}</g>`
		+ elapsedText
		+ `</svg>`;

	return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function escXml(s: string): string {
	return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/**
 * Builds a 144×144 rate-limit error image for the toggle button.
 * Shows a warning icon, "API limit" label, and a countdown until reset.
 */
export function buildRateLimitImage(countdown: string): string {
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="144" height="144">`
		+ `<rect width="100" height="100" rx="20" fill="#1a0000"/>`
		+ `<text x="50" y="16" font-family="sans-serif" font-size="12" font-weight="bold" fill="#e04040" text-anchor="middle">API limit</text>`
		+ `<g transform="translate(22,23) scale(2.33)" fill="#e04040">${ICON_WARNING}</g>`
		+ `<text x="50" y="92" font-family="sans-serif" font-size="13" font-weight="bold" fill="#e04040" text-anchor="middle">${escXml(countdown)}</text>`
		+ `</svg>`;
	return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}
