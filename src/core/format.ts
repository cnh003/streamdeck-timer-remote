/** Formats the elapsed time since `startTime` as m:ss or h:mm:ss. */
export function formatElapsed(startTime: Date): string {
	const secs = Math.max(0, Math.floor((Date.now() - startTime.getTime()) / 1000));
	const h  = Math.floor(secs / 3600);
	const m  = Math.floor((secs % 3600) / 60);
	const s  = secs % 60;
	const mm = String(m).padStart(2, "0");
	const ss = String(s).padStart(2, "0");
	return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}
