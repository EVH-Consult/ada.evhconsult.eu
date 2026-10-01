<p align="center">
  <img src="assets/ada-avatar-800x800.png"
       width="180"
       alt="Ada — AI persona and assistant of EVH Consult">
</p>

# Ada website

This is the canonical implementation repository for
[ada.evhconsult.eu](https://ada.evhconsult.eu), Ada's public website in the
EVH Consult ecosystem.

It owns the website source, site-specific assets, deployment workflow,
analytics integration and technical implementation documentation. It does not
own Ada's durable identity or governance, private runtime context, provider
state, or general public Ada knowledge and reusable assets.

## Source-of-truth boundaries

- [EVHConsult-AI/ada](https://github.com/EVHConsult-AI/ada) is the reviewed
  public Ada knowledge/assets repository. It was narrowed under EVHC-158 and
  no longer contains or owns website implementation.
- `EVHConsult-AI/ada-context` is the private version-controlled runtime/tooling
  adapter repository. It is not website input.
- Confluence owns durable Ada identity, personality, editorial governance and
  architectural decisions.
- Azure Static Web Apps owns volatile deployment/runtime state.

The repository history was transferred from `EVHConsult-AI/ada` under
EVHC-156 using the original Git commit graph. Historical commits therefore
preserve evidence of the earlier combined repository model, while the current
public Ada repository and website repository now have separate responsibilities.

## Implementation

The site is framework-free static HTML, CSS and JavaScript. There is no package
installation, build step, backend or authentication requirement for the public
site.

Main files:

- `index.html` — page structure, content and metadata;
- `styles.css` and `evhc-45-responsive.css` — presentation and responsive
  behaviour;
- `script.js` and `consent.css` — navigation and consent UI;
- `ga4.js` — consent-gated Google Analytics 4 loading;
- `assets/` — website images and social presentation assets;
- `robots.txt`, `sitemap.xml` and `site.webmanifest` — public discovery and
  application metadata.

## Local validation

Serve the repository root with any static HTTP server and open `/`. Directly
opening `index.html` is sufficient for basic visual inspection, but an HTTP
server is preferable for checking paths and browser behaviour.

Before merging a website change, verify at minimum:

- the root page and referenced assets load without browser errors;
- navigation and external links remain correct;
- title, canonical URL, social metadata, favicon, sitemap and robots metadata
  remain coherent;
- Google Analytics is absent before consent, loads after acceptance and remains
  blocked after refusal;
- no secrets or provider credentials are present.

## Deployment

Azure Static Web Apps deploys `main` through
`.github/workflows/azure-static-web-apps-red-pond-05c783d0f.yml`.

- application location: `/`;
- API location: none;
- output location: `.`;
- production domain: `https://ada.evhconsult.eu`;
- preview environments: created for supported pull-request events;
- deployment credential: GitHub Actions secret
  `AZURE_STATIC_WEB_APPS_API_TOKEN_RED_POND_05C783D0F`.

The secret name is safe to document; its value must remain provider-managed and
must never be committed or printed. A successful workflow run is not by itself
proof of migration: production must also be checked on the custom domain after
the merged `main` deployment.

EVHC-156 established this repository as the production source. The verified
migration merge is `0c9ff648403c4ba6a230e6ff8f150bece814bdb4`, deployed by
GitHub Actions run `33588455461`. EVHC-158 subsequently removed the legacy
website/deployment responsibility from `EVHConsult-AI/ada`.

## Analytics and privacy

GA4 is optional and remains blocked until explicit analytics consent. The
strictly functional consent-preference cookie is shared across
`*.evhconsult.eu` for at most six months. The public privacy and cookie notice
is maintained at [evhconsult.eu/privacy.html](https://evhconsult.eu/privacy.html).

Page identity uses `hostname` + `page_path`; `page_title` remains human-readable
presentation. This site uses identity-first titles beginning with `Ada —` and
reports `content_group = Ada` only after analytics consent.

The measurement identifier in the client-side loader is a public analytics
configuration value, not a credential. Do not add unrestricted operational
detail or security/recovery material to this repository.

## Consent synchronization

The functional shared cookie is re-read at the Google opt-out boundary and before
custom-event emission. A denied, missing or malformed preference disables
collection even before this document runs its synchronization callbacks. Focus,
page show (including bfcache), visibility and Cookie Store changes reapply the
Google consent state; a 250 ms cookie poll covers browsers without Cookie Store
and changes from other subdomains. The poll never renews the 180-day preference.
Advertising consent stays denied. Expiry opens the consent prompt again.

The tag is configured once per document, so refusal/regrant does not send a
second initial page view. `EVHAnalytics.isLoaded()` reports whether tracking is
currently available; `track()` rechecks consent and the exact production host
and returns whether it enqueued the event. The opt-out accessor suppresses
new Google events after another context changes the cookie. A separate dispatch
guard drops buffered GA collection requests when the shared preference is no
longer granted. It covers beacon, fetch, image and XHR transports only for Google
Analytics collection endpoints; other network requests retain native behaviour.

Run the behavioral regressions with `node --test tests/*.test.cjs` (AI site:
`node --test src/web/tests/*.test.cjs` from the repository root). Real production
network/storage verification remains a separate deployment and acceptance gate.
