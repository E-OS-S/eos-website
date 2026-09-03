/**
 * eos-website — site configuration.
 *
 * Every flag here changes what the built HTML contains, not what a browser is
 * asked to hide. On a static host there is no other kind of gate (WS-005).
 */

/** Locales, in menu order. The first one is the default. */
export const locales = ['pl', 'en'];
export const defaultLocale = 'pl';

/** Canonical site origin. Used for <link rel=canonical> and hreflang. */
export const site = 'https://e-os.gitlab.io/eos-website';
export const base = '/eos-website';

/**
 * Downloads gate (owner decision, 2026-09-03, ROADMAP WS-005).
 *
 * `developerOnly: true` means the artefact links are NOT rendered into the
 * HTML at all. A static host cannot check who is asking, so a client-side
 * "are you a developer?" toggle would be decoration, not access control. The
 * page says so in the text; this flag is what actually withholds the links.
 *
 * Flipping this to `false` publishes `artefacts` below. Nothing else changes.
 */
export const downloads = {
  developerOnly: true,
  /** Rendered only when developerOnly === false. Empty until artefacts are signed and hosted. */
  artefacts: [],
};

/** Ticket system (owner decision, 2026-09-03, ROADMAP WS-009). */
export const support = {
  /** GitLab project that holds the tickets. Issues are the ticket store. */
  issuesProject: 'e-os/eos-support',
  issuesNewUrl: 'https://gitlab.com/e-os/eos-support/-/issues/new',
  issuesListUrl: 'https://gitlab.com/e-os/eos-support/-/issues',
  /** Issue description templates that must exist in the project. */
  templates: ['bug', 'question', 'hardware', 'documentation'],
  /**
   * AI chat: designed, not built (WS-010). No endpoint exists and none is
   * called. The panel on the support page is a design summary with a link to
   * docs/ai-chat-design.md.
   */
  aiChat: { built: false, designDoc: 'docs/ai-chat-design.md' },
};

/** Upstream/first-party links used across pages. */
export const links = {
  gitlab: 'https://gitlab.com/e-os/e-os',
  github: 'https://github.com/Gh0s777tt/E-OS',
  gitlabGroup: 'https://gitlab.com/e-os',
  roadmap: 'https://gitlab.com/e-os/e-os/-/blob/main/ROADMAP.md',
  claudeMd: 'https://gitlab.com/e-os/e-os/-/blob/main/CLAUDE.md',
  architecture: 'https://gitlab.com/e-os/e-os/-/blob/main/ARCHITECTURE.md',
  contributing: 'https://gitlab.com/e-os/e-os/-/blob/main/CONTRIBUTING.md',
  security: 'https://gitlab.com/e-os/e-os/-/blob/main/SECURITY.md',
  trademark: 'https://gitlab.com/e-os/e-os/-/blob/main/TRADEMARK.md',
  notice: 'https://gitlab.com/e-os/e-os/-/blob/main/NOTICE',
  license: 'https://gitlab.com/e-os/e-os/-/blob/main/LICENSE',
  changelog: 'https://gitlab.com/e-os/e-os/-/blob/main/CHANGELOG.md',
  hardware: 'https://gitlab.com/e-os/e-os/-/blob/main/HARDWARE.md',
  docs: 'https://gitlab.com/e-os/e-os/-/tree/main/docs',
  issues: 'https://gitlab.com/e-os/e-os/-/issues',
  advisories: 'https://github.com/Gh0s777tt/E-OS/security/advisories/new',
  redox: 'https://www.redox-os.org',
  redoxTrademarkContact: 'mailto:trademark@redox-os.org',
  securityContact: 'mailto:dzierzawskii98.dam@gmail.com',
};

export default { locales, defaultLocale, site, base, downloads, support, links };
