# Security

## Reporting a problem

Please report security issues privately through GitHub's **Report a vulnerability** (Security tab of this repository) instead of a public issue. Include the steps to reproduce and what an attacker could gain.

## What the project protects

- **Stremio account.** The site asks only for an AuthKey, sends it straight to the Stremio API from your browser and never stores it. It changes only Dublix's own addons, downloads a backup first, and refuses to install if your addon list changed since the review.
- **Debrid and TMDB keys.** They go into your AIOStreams profile on the instance you choose, once, through `/api/aio` (no logs, no storage) or directly to your own server. The profile password is generated in your browser.
- **The `/api/aio` bridge** only creates a profile or reads the status of an allow-listed instance, accepts JSON only, limits the body size and never follows redirects.
- **The site** runs with a strict Content Security Policy (no inline scripts, no third-party scripts or fonts) and shows addon names as text.
- **The self-host kit** keeps AIOStreams from reaching private network addresses, accepts only the regex and expression lists the Dublix profile uses, rate-limits profile creation and hides the AIOStreams configuration pages. See [kit/README.md](kit/README.md#exposure).

## Known limits

- Synced filter lists (Tamtaro, Vidhin05) are maintained by third parties and can change; they affect ranking and exclusions, not your keys.
- Anyone who can reach a self-hosted gateway can create a profile on it; that is how the site installs from the browser.
