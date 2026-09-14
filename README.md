# BioSync

BioSync turns the track currently playing on Spotify into a TikTok-ready bio.

The app is intentionally a small, dependency-free static site. It uses Spotify's Authorization Code with PKCE flow in the browser, reads the current playback, formats the track and artist within a configurable character limit, and gives you a one-click copy action.

## Current product boundary

TikTok does not currently provide a public API endpoint for editing a user's profile bio. BioSync therefore uses the safest useful workflow:

1. Connect Spotify.
2. Play a track.
3. Copy the generated bio.
4. Open TikTok, edit the profile, and paste it.

The TikTok button opens the official site; it does not pretend that a profile update succeeded.

## Local setup

1. Create an app in the Spotify Developer Dashboard.
2. Copy its Client ID. Do not use or expose the Client Secret.
3. Serve this folder over HTTP. For example, with Python:

   python -m http.server 4173

4. Open http://127.0.0.1:4173/ in your browser.
5. Add the exact URL shown as Redirect URI in the Spotify app settings.
6. Paste your Client ID into BioSync and connect.

Spotify redirect URIs must match exactly. For local development, use the explicit loopback address http://127.0.0.1:4173/ rather than localhost. A hosted deployment must use HTTPS.

## GitHub Pages deployment

The included workflow in .github/workflows/pages.yml deploys the repository as a static GitHub Pages site whenever main changes.

After enabling Pages with GitHub Actions:

1. Open the deployed site.
2. Copy its exact URL, including any repository path.
3. Add that exact URL as a Spotify redirect URI.
4. Enter the Spotify Client ID in the site.

## Privacy and security

- There is no backend and no analytics.
- No Spotify Client Secret is ever requested.
- The access token and refresh token are kept in sessionStorage and are removed when you disconnect.
- Only the Spotify scopes needed for this experience are requested: user-read-currently-playing and user-read-private.
- The app does not store a Spotify catalog or playback history.
- Spotify track metadata is attributed through the link back to Spotify.

For a production public launch, consider adding a small backend for stronger token lifecycle control, a Content Security Policy, automated browser tests, and a supported TikTok integration if TikTok exposes a write endpoint in the future.

## Roadmap

- Add a backend option for durable, encrypted token sessions.
- Add a preview of the TikTok profile layout.
- Add more bio templates and user-defined templates.
- Add tests for Unicode length, truncation, token expiry, and 204/401/429 Spotify responses.
- Re-check TikTok developer capabilities before attempting automatic profile updates.