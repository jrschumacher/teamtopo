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
