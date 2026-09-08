/** Browser tab title: "<diagram title> · teamtopo" when the source names one, else "teamtopo". */
export function pageTitle(title?: string | null): string {
	const t = title?.trim();
	return t ? `${t} · teamtopo` : 'teamtopo';
}

/** Four-square wordmark, shared by the editor and viewer header shells (see editor.css). */
export function brandMarkHtml(): string {
	return (
		'<span class="ed-mark" aria-hidden="true">' +
		'<i class="ed-sq ed-sq-stream"></i>' +
		'<i class="ed-sq ed-sq-enabling"></i>' +
		'<i class="ed-sq ed-sq-subsystem"></i>' +
		'<i class="ed-sq ed-sq-platform"></i>' +
		'</span>'
	);
}
