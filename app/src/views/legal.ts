/**
 * Privacy and terms pages. Each document is Markdown in the subset `renderMarkdown`
 * handles (headings, paragraphs, bullets, inline code and links), wrapped in the landing
 * chrome. Every statement below describes what the code in this repo actually does; change
 * the text when the behaviour changes, and bump the effective date.
 */
import { pageTitle } from '../lib/brand';
import { renderMarkdown } from '../lib/markdown';
import { ATTRIBUTION_MD, footerHtml, navHtml } from './chrome';
import './landing.css';
import './legal.css';

export type LegalPage = 'privacy' | 'terms';

export const EFFECTIVE_DATE = { iso: '2026-09-08', text: '8 September 2026' };

const CONTACT = 'hello@teamtopo.dev';

const PRIVACY = `
teamtopo is a free tool that turns text into Team Topologies diagrams. This page explains what data the hosted service at teamtopo.dev handles and what it does not. The short version: there are no accounts, your diagrams are encrypted in your browser before they leave it, and we cannot read them.

## No accounts

There is nothing to sign up for. We do not collect names, passwords or profile details.

## Your diagrams

- When you save a diagram, your browser encrypts the text with AES-256-GCM before uploading it. The key is derived from a secret that lives only in the URL fragment (the part after \`#\`). Browsers never send the fragment to a server, so the key never reaches us.
- Our server stores the encrypted text in Cloudflare R2, together with the document id, the time and size of each save, and a hash of the write token. It cannot decrypt the diagram.
- The document id is a random UUID. It says nothing about you or about the content.
- Anyone who has the edit link can edit the diagram; anyone who has the view link can read it. Links are the only access control, so share them with that in mind.
- Every save adds a version. The most recent 100 versions of a document are kept; older ones are deleted as new ones are added.
- Diagrams are kept until they are deleted. There is no automatic expiry today. If you lose the link, nobody can recover the content, including us, because the key was never on our side.

## The examples on the home page

The live demo on the home page types out the example topologies that ship with teamtopo. They are not user data.

## Email updates

Signing up for updates is optional. If you do:

- We store your email address, a random confirmation token, and the times you signed up, confirmed and unsubscribed, in Cloudflare D1.
- Signup is double opt-in: we send one confirmation email, and the address only counts as subscribed once you open the link in it. Unconfirmed signups expire after seven days.
- The address is used only to announce new teamtopo features. The confirmation email carries a one-click unsubscribe link, and so will every update we send.
- The list is never linked to any diagram. Nothing connects an email address to a document id.
- Unsubscribing marks the address as unsubscribed. Email us if you want the record removed entirely.

## Usage analytics

We count usage with Cloudflare Workers Analytics Engine. Each event records the event type (a document was created, viewed or saved, an email address was confirmed, and so on), the document id, the API route pattern, the size of the encrypted payload and the number of versions the document holds. Events never contain IP addresses, user agents, email addresses or concrete URLs.

A Cloudflare Web Analytics page-view beacon may be present on pages. It is cookieless, and it is only ever loaded by the home page, so it never observes diagram links; it also strips the URL fragment before sending, so keys cannot leave your browser this way either.

## Server logs

Cloudflare Worker logs are enabled and persisted so we can debug failures. They can contain request URLs without the fragment (so never a key), request metadata and error messages, and are retained according to Cloudflare's defaults.

## Rate limiting and IP addresses

Creating and saving diagrams and signing up for email are rate limited per IP address using Cloudflare's rate-limiting service. The app itself never stores IP addresses; Cloudflare processes them to deliver the site and apply those limits.

## Cookies and browser storage

teamtopo sets no cookies. Two things are kept in your browser only:

- The editor for a new, unsaved diagram keeps a draft in your browser's local storage (under the key \`teamtopo.draft\`) so a reload does not lose your work. It is cleared when you save.
- Diagrams you open are cached in memory for the current tab, so moving between a diagram, its team pages and its versions does not refetch them. The cache is gone when the tab closes.

## Where the data lives

The service runs entirely on Cloudflare: Workers for the application, R2 for encrypted documents, D1 for the email list, Email Service for confirmation mail, Analytics Engine and Web Analytics for usage counts, and Cloudflare rate limiting. Cloudflare is our only subprocessor.

## Deleting your data

To delete a diagram, email ${CONTACT} with the document id, which is the part of the link after \`/d/\`. Do not send the part after \`#\`. To have your email address removed, use the unsubscribe link or write to us from that address.

## Children

teamtopo is not directed at children under 13, and we do not knowingly collect their data.

## Changes

Changes to this policy are posted on this page with a new effective date.

## Contact

[${CONTACT}](mailto:${CONTACT})
`;

const TERMS = `
These terms cover the hosted teamtopo service at teamtopo.dev. By using it you agree to them.

## The service is free

teamtopo is free to use and there is no paid tier planned. It is provided as-is and as-available: we make no guarantee about uptime, or that stored diagrams will not be lost or corrupted. Keep your own copy of anything you cannot afford to lose; the source text is small and easy to copy out.

## Your links are your keys

Diagrams are encrypted in your browser and the key lives only in the link. We never have it. If you lose an edit or view link we cannot recover the diagram, or the ability to edit it, for you or for anyone else. Anyone you give a link to can use it; sharing a link is sharing access.

## Your content

You own what you write. You grant us only the licence we need to store the encrypted text and serve it to whoever presents a valid link. We cannot read it and claim no other rights to it. You are responsible for what you store and share, including for having the right to share it.

## Acceptable use

Do not use the service to:

- store or share content that is unlawful, or that you do not have the right to share
- abuse the API or the rate limits, for instance by scripting bulk uploads or scraping
- attempt to access, modify or break other people's documents, or the service itself

Limits that apply today: a document is capped at 256 KB of encrypted text, the most recent 100 versions are kept, and creating or saving documents and signing up for email are rate limited per IP address.

## Protecting the service

We may remove content or block access, without notice, when we believe it is necessary to protect the service or other users, or to comply with the law. Because documents are encrypted we can only act on a document id, never on its content.

## Open source

The teamtopo library and CLI are open source under the MIT licence on [GitHub](https://github.com/jrschumacher/teamtopo). That licence covers the source code. It does not cover the hosted service; use of teamtopo.dev is governed by these terms.

## Team Topologies

${ATTRIBUTION_MD}

## Limitation of liability

To the fullest extent permitted by law, we are not liable for any loss or damage arising from your use of, or inability to use, the service, including lost diagrams, lost links or lost data.

## Termination

You can stop using the service at any time, and can ask us to delete your documents (see the [privacy page](/privacy)). We may change or shut down the service; if we shut it down we will post notice on the site first.

## Changes

Changes to these terms are posted on this page with a new effective date. Continuing to use the service after a change means you accept it.

## Contact

[${CONTACT}](mailto:${CONTACT})
`;

const DOCS: Record<LegalPage, { title: string; markdown: string }> = {
	privacy: { title: 'Privacy', markdown: PRIVACY },
	terms: { title: 'Terms', markdown: TERMS }
};

export function renderLegal(root: HTMLElement, page: LegalPage): void {
	const { title, markdown } = DOCS[page];
	document.title = pageTitle(title);
	root.innerHTML = `<div class="landing legal">
	${navHtml('/#features')}
	<main class="legal-main" id="legal-${page}">
		<article class="legal-doc">
			<h1 class="legal-title">${title}</h1>
			<p class="legal-effective">Effective <time datetime="${EFFECTIVE_DATE.iso}">${EFFECTIVE_DATE.text}</time></p>
			${renderMarkdown(markdown)}
		</article>
	</main>
	${footerHtml()}
</div>`;
}
