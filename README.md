# BioSync

BioSync turns the track currently playing on Spotify into a TikTok-ready bio.

There are two ways to use it:

- The [GitHub Pages dashboard](https://deplane-hash.github.io/spotify-tiktok-bio-changer/) is the lightweight manual workflow: connect Spotify, generate a bio, copy it, then paste it in TikTok.
- The **experimental Opera edition** adds an opt-in local companion and browser extension that can update a signed-in TikTok tab automatically. Start with [the Opera setup guide](OPERA_SETUP.md).

## Dashboard: manual workflow

The public dashboard is intentionally a small, dependency-free static site. It uses Spotify's Authorization Code with PKCE flow in the browser, reads the current playback, formats the track and artist within a configurable character limit, and gives you a one-click copy action.

TikTok does not currently provide a public API endpoint for editing a user's profile bio. The dashboard therefore uses the safest useful workflow:

1. Connect Spotify.
2. Play a track.
3. Copy the generated bio.
4. Open TikTok, edit the profile, and paste it.

The TikTok button opens the official site; it does not pretend that a profile update succeeded.

## Opera automatic sync: experimental

The Opera version is deliberately local-first:

- The `local-companion` starts on your computer at `http://127.0.0.1:38473`.
- It reads only Spotify’s current track with the `user-read-currently-playing` scope.
- The `opera-extension` has to be installed manually in Opera and its **Automatic sync** switch defaults to off.
- TikTok credentials are never collected or stored; you sign in to TikTok yourself.
- Because TikTok has no public bio-write API, the extension uses the TikTok website’s own Edit profile controls and can break if TikTok changes that UI.

Read [OPERA_SETUP.md](OPERA_SETUP.md) for exact Spotify redirect-URI, Opera installation, start/stop, and package-download steps.

## Dashboard local setup

1. Create an app in the Spotify Developer Dashboard.
2. Copy its Client ID. Do not use or expose the Client Secret.
3. Serve this folder over HTTP. For example, with Python:

   ```text
   python -m http.server 4173
   ```

4. Open `http://127.0.0.1:4173/` in your browser.
5. Add the exact URL shown as Redirect URI in the Spotify app settings.
6. Paste your Client ID into BioSync and connect.

Spotify redirect URIs must match exactly. For local development, use the explicit loopback address `http://127.0.0.1:4173/` rather than `localhost`. A hosted deployment must use HTTPS.

## GitHub Pages deployment

The included workflow in `.github/workflows/pages.yml` deploys the repository as a static GitHub Pages site whenever `main` changes.

After enabling Pages with GitHub Actions:

1. Open the deployed site.
2. Copy its exact URL, including any repository path.
3. Add that exact URL as a Spotify redirect URI.
4. Enter the Spotify Client ID in the site.

## Privacy and security

- There is no analytics or Spotify catalog/history storage.
- No Spotify Client Secret is ever requested.
- The dashboard’s Spotify tokens live in `sessionStorage` and are removed when you disconnect.
- The Opera companion keeps its Spotify tokens in memory only; restarting it requires reconnecting Spotify.
- The companion is reachable only on your local computer’s loopback address.
- You can turn Opera automatic sync off or remove the extension at any time.

## Roadmap

- Add stable end-to-end tests using a test profile/page.
- Add an optional configurable poll interval and a preview-only mode.
- Improve TikTok selector recovery when the website UI changes.
- Re-check TikTok developer capabilities before replacing browser automation with a supported API.
