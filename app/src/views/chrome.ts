/**
 * Site chrome shared by the landing page and the legal pages: the top nav and the footer.
 * Ids and classes are part of the landing design contract (docs/landing-design.md); the
 * styles live in landing.css.
 */

import { renderMarkdown } from '../lib/markdown';

export const GITHUB_URL = 'https://github.com/jrschumacher/teamtopo';
export const LICENSE_URL = 'https://github.com/jrschumacher/teamtopo/blob/main/LICENSE';

/** The attribution wording, as Markdown so the terms page can embed it verbatim. */
export const ATTRIBUTION_MD =
	'Team shapes and the Team API template are from [Team Topologies](https://teamtopologies.com) ([CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)). This project is not affiliated with or endorsed by Team Topologies.';

/** The same sentence as inline HTML for the footer. */
export const ATTRIBUTION_HTML = renderMarkdown(ATTRIBUTION_MD).replace(/^<p>|<\/p>$/g, '');

export function brandSquaresHtml(): string {
	return '<span class="brand-mark" aria-hidden="true"><i class="sq sq-stream"></i><i class="sq sq-enabling"></i><i class="sq sq-subsystem"></i><i class="sq sq-platform"></i></span>';
}

/** `featuresHref` is `#features` on the landing itself and `/#features` everywhere else. */
export function navHtml(featuresHref: string): string {
	return `<nav class="landing-nav" id="landing-nav">
		<a class="nav-brand" href="/">
			${brandSquaresHtml()}
			teamtopo
		</a>
		<span class="free-pill">Free</span>
		<span class="nav-spacer"></span>
		<a class="nav-link" href="${featuresHref}">Features</a>
		<a class="nav-link" href="${GITHUB_URL}">GitHub</a>
		<a class="nav-cta" href="/new">Open the editor</a>
	</nav>`;
}

export function footerHtml(): string {
	return `<footer class="site-footer" id="site-footer">
		<div class="footer-inner">
			<div class="footer-brand">
				<div class="footer-wordmark">${brandSquaresHtml()}teamtopo</div>
				<p class="attribution" id="attribution">${ATTRIBUTION_HTML}</p>
			</div>
			<div class="footer-meta">
				<p class="footer-links">
					<a id="footer-github" href="${GITHUB_URL}">GitHub</a>
					<a href="${LICENSE_URL}">MIT license</a>
					<a id="footer-privacy" href="/privacy">Privacy</a>
					<a id="footer-terms" href="/terms">Terms</a>
				</p>
				<p class="footer-made">Made with <span class="footer-made-mark" aria-hidden="true"><i class="sq sq-stream"></i><i class="sq sq-enabling"></i><i class="sq sq-subsystem"></i><i class="sq sq-platform"></i></span> at <a href="https://aboldnewlook.com">aboldnewlook.com</a></p>
			</div>
		</div>
	</footer>`;
}
