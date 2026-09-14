# BioSync for Opera — experimental automatic sync

This is the Opera edition of BioSync. It keeps a small local companion running on your own computer, reads your currently playing Spotify track, and uses an Opera extension to update the bio on a TikTok tab where **you are already logged in**.

## What it does

1. The local companion reads the current Spotify track using your own Spotify authorization.
2. It waits for the song to be stable for the configured number of seconds.
3. If **Automatic sync** is enabled in the Opera extension and a TikTok tab is open, the extension updates the bio with the formatted track line.

The companion is bound to `127.0.0.1` only. Your Spotify client ID and bio preferences are stored locally. Spotify tokens stay in memory and are cleared whenever the companion stops.

## Important limits

TikTok does not offer a public profile-bio write API. The Opera extension therefore automates the normal TikTok web-profile controls in your signed-in browser session. TikTok can change its interface at any time, so treat this as experimental.

Keep the extension switched **off** until the Spotify connection, formatted bio, and TikTok tab are all correct. It will never ask for or store your TikTok password. You must sign into TikTok yourself.

## Install on Windows

### 1. Install Node.js

Install Node.js 20 or newer from [nodejs.org](https://nodejs.org/). Then open PowerShell in the cloned/downloaded repository and run:

```powershell
cd local-companion
npm start
```

Leave that PowerShell window open. The companion starts at [http://127.0.0.1:38473](http://127.0.0.1:38473).

### 2. Configure Spotify

1. Visit the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard), create an app, and copy its **Client ID**. Do not use a Client Secret.
2. In that Spotify app, add this exact Redirect URI:

   ```
   http://127.0.0.1:38473/auth/spotify/callback
   ```

3. Open [http://127.0.0.1:38473](http://127.0.0.1:38473).
4. Paste the Client ID, choose your base bio/template, save, and select **Connect Spotify**.
5. Approve the single `user-read-currently-playing` permission in Spotify.

### 3. Load the extension in Opera

1. Open `opera:extensions` in Opera.
2. Turn on **Developer mode**.
3. Select **Load unpacked**.
4. Choose this repository’s `opera-extension` folder.
5. Pin **BioSync for Opera** from Opera’s extensions menu.

Opera supports Chrome-compatible Manifest V3 extensions, so this project uses the standard `chrome.*` extension APIs. See Opera’s [extension overview](https://help.opera.com/en/extensions/) for the developer-mode workflow.

### 4. Turn on automatic sync

1. Sign in to TikTok in Opera yourself and keep a TikTok tab open.
2. Play a Spotify song and wait until the local setup page says **Ready to sync**.
3. Open the BioSync extension popup. Confirm the queued bio is correct.
4. Switch **Automatic sync** on.

The extension checks about once a minute. If it cannot find TikTok’s Edit profile, Bio field, or Save button, it reports the problem and makes no claim that the update completed.

## Stop or remove it

- Turn **Automatic sync** off in the extension popup to stop updates immediately.
- Close the companion PowerShell window to stop local Spotify polling; reconnect Spotify when you start it again.
- In `opera:extensions`, remove BioSync to uninstall the browser extension.
- Delete the local settings file at `%LOCALAPPDATA%\\BioSync\\settings.json` if you want to erase saved preferences.

## Build a download zip

GitHub Actions includes a **Package Opera extension** workflow. Run it manually from the repository’s Actions tab to produce a downloadable `biosync-opera-extension.zip` artifact. Creating a tag that begins with `opera-v` also attaches that zip to the corresponding GitHub release.
