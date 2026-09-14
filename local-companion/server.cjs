"use strict";

const http = require("node:http");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const HOST = "127.0.0.1";
const PORT = 38473;
const CALLBACK_URL = "http://127.0.0.1:38473/auth/spotify/callback";
const SETTINGS_DIR = process.env.BIOSYNC_DATA_DIR || path.join(process.env.LOCALAPPDATA || process.cwd(), "BioSync");
const SETTINGS_FILE = path.join(SETTINGS_DIR, "settings.json");
const PUBLIC_DIR = path.join(__dirname, "public");
const SPOTIFY_AUTHORIZE_URL = "https://accounts.spotify.com/authorize";
const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
const SPOTIFY_CURRENT_URL = "https://api.spotify.com/v1/me/player/currently-playing";
const DEFAULT_SETTINGS = {
  clientId: "",
  baseBio: "",
  template: "🎧 {track} — {artist}",
  maxLength: 80,
  stableSeconds: 25
};

let settings = readSettings();
let tokens = null;
let oauth = null;
let state = {
  nowPlaying: null,
  candidate: null,
  sync: null,
  lastSync: null,
  lastError: null,
  checking: false
};

function readSettings() {
  try {
    const saved = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"));
    return { ...DEFAULT_SETTINGS, ...saved };
  } catch (error) {
    return { ...DEFAULT_SETTINGS };
  }
}

function writeSettings() {
  fs.mkdirSync(SETTINGS_DIR, { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), "utf8");
}

function randomUrlSafe(length) {
  return crypto.randomBytes(length).toString("base64url").slice(0, length);
}

function codeChallenge(verifier) {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

function codePointLength(value) {
  return Array.from(value).length;
}

function shorten(value, limit) {
  const characters = Array.from(String(value || "").trim());
  if (characters.length <= limit) return characters.join("");
  if (limit <= 1) return characters.slice(0, limit).join("");
  return characters.slice(0, limit - 1).join("") + "…";
}

function formatBio(track) {
  const artist = track.artist || "Unknown artist";
  const line = String(settings.template || DEFAULT_SETTINGS.template)
    .replaceAll("{track}", track.name || "Unknown track")
    .replaceAll("{artist}", artist)
    .replace(/\s+/g, " ")
    .trim();
  const base = String(settings.baseBio || "").trim();
  const full = base ? base + "\n" + line : line;
  return shorten(full, settings.maxLength);
}

function publicStatus() {
  const message = state.lastError
    ? state.lastError
    : !settings.clientId
      ? "Add a Spotify Client ID in local setup."
      : !tokens
        ? "Connect Spotify in local setup."
        : state.sync && state.sync.ready
          ? "A stable song is ready to sync."
          : state.nowPlaying
            ? "Watching the current Spotify track."
            : "Play a track on Spotify to begin.";

  return {
    message,
    configured: Boolean(settings.clientId),
    connected: Boolean(tokens && tokens.accessToken),
    nowPlaying: state.nowPlaying,
    sync: state.sync,
    lastSync: state.lastSync,
    settings: {
      baseBio: settings.baseBio,
      template: settings.template,
      maxLength: settings.maxLength,
      stableSeconds: settings.stableSeconds
    }
  };
}

async function refreshAccessTokenIfNeeded() {
  if (!tokens || !tokens.refreshToken || Date.now() < tokens.expiresAt - 60000) {
    return;
  }

  const body = new URLSearchParams({
    client_id: settings.clientId,
    grant_type: "refresh_token",
    refresh_token: tokens.refreshToken
  });

  const response = await fetch(SPOTIFY_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  const data = await response.json();

  if (!response.ok) {
    tokens = null;
    throw new Error(data.error_description || "Spotify login expired. Connect again.");
  }

  tokens = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || tokens.refreshToken,
    expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000
  };
}

async function getCurrentTrack() {
  await refreshAccessTokenIfNeeded();

  const response = await fetch(SPOTIFY_CURRENT_URL + "?additional_types=track", {
    headers: { Authorization: "Bearer " + tokens.accessToken }
  });

  if (response.status === 204) return null;
  if (response.status === 401) {
    tokens = null;
    throw new Error("Spotify login expired. Connect again.");
  }
  if (response.status === 429) {
    const retryAfter = response.headers.get("retry-after") || "60";
    throw new Error("Spotify asked BioSync to retry in " + retryAfter + " seconds.");
  }

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error && data.error.message ? data.error.message : "Spotify playback could not be read.");
  }
  if (!data.is_playing || !data.item || data.item.type !== "track") return null;

  return {
    id: data.item.id,
    name: data.item.name,
    artist: (data.item.artists || []).map((artist) => artist.name).filter(Boolean).join(", "),
    album: data.item.album && data.item.album.name ? data.item.album.name : "",
    url: data.item.external_urls && data.item.external_urls.spotify ? data.item.external_urls.spotify : ""
  };
}

function clearCurrentTrack() {
  state.nowPlaying = null;
  state.candidate = null;
  state.sync = null;
}

async function inspectSpotify() {
  if (state.checking || !tokens || !settings.clientId) return;
  state.checking = true;

  try {
    const track = await getCurrentTrack();
    state.lastError = null;

    if (!track) {
      clearCurrentTrack();
      return;
    }

    state.nowPlaying = track;
    const candidate = state.candidate;

    if (!candidate || candidate.track.id !== track.id) {
      state.candidate = {
        key: track.id + ":" + Date.now(),
        track,
        detectedAt: Date.now()
      };
      state.sync = null;
      return;
    }

    state.candidate.track = track;
    const stableFor = Date.now() - state.candidate.detectedAt;
    const stableMs = Math.max(10, Number(settings.stableSeconds || 25)) * 1000;

    if (stableFor >= stableMs && (!state.sync || state.sync.key !== state.candidate.key)) {
      state.sync = {
        ready: true,
        key: state.candidate.key,
        bio: formatBio(track),
        track,
        detectedAt: state.candidate.detectedAt
      };
    }
  } catch (error) {
    state.lastError = error && error.message ? error.message : "BioSync could not read Spotify.";
  } finally {
    state.checking = false;
  }
}

async function exchangeAuthorizationCode(code) {
  if (!oauth || !oauth.verifier) throw new Error("Spotify login session expired. Start login again.");

  const body = new URLSearchParams({
    client_id: settings.clientId,
    grant_type: "authorization_code",
    code,
    redirect_uri: CALLBACK_URL,
    code_verifier: oauth.verifier
  });

  const response = await fetch(SPOTIFY_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error_description || "Spotify did not complete login.");

  tokens = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || null,
    expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000
  };
  oauth = null;
  state.lastError = null;
  await inspectSpotify();
}

function json(response, status, data) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(data));
}

function text(response, status, data, type) {
  response.writeHead(status, {
    "Content-Type": type || "text/plain; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(data);
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 50000) {
        reject(new Error("Request body is too large."));
        request.destroy();
      }
    });
    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(new Error("Request body must be valid JSON."));
      }
    });
    request.on("error", reject);
  });
}

function updateSettings(next) {
  if (typeof next.clientId === "string" && next.clientId.trim()) settings.clientId = next.clientId.trim();
  if (typeof next.baseBio === "string") settings.baseBio = next.baseBio.slice(0, 240);
  if (typeof next.template === "string") settings.template = next.template.slice(0, 160);
  if (Number.isFinite(Number(next.maxLength))) settings.maxLength = Math.max(10, Math.min(150, Number(next.maxLength)));
  if (Number.isFinite(Number(next.stableSeconds))) settings.stableSeconds = Math.max(10, Math.min(300, Number(next.stableSeconds)));
  state.sync = null;
  writeSettings();
}

function servePublic(response, fileName, contentType) {
  const filePath = path.join(PUBLIC_DIR, fileName);
  try {
    text(response, 200, fs.readFileSync(filePath), contentType);
  } catch (error) {
    text(response, 404, "Not found.");
  }
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, "http://" + HOST + ":" + PORT);

  if (request.method === "OPTIONS") {
    response.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    });
    response.end();
    return;
  }

  if (request.method === "GET" && url.pathname === "/") {
    servePublic(response, "index.html", "text/html; charset=utf-8");
    return;
  }
  if (request.method === "GET" && url.pathname === "/app.js") {
    servePublic(response, "app.js", "application/javascript; charset=utf-8");
    return;
  }
  if (request.method === "GET" && url.pathname === "/styles.css") {
    servePublic(response, "styles.css", "text/css; charset=utf-8");
    return;
  }
  if (request.method === "GET" && url.pathname === "/v1/status") {
    json(response, 200, publicStatus());
    return;
  }
  if (request.method === "POST" && url.pathname === "/v1/settings") {
    try {
      updateSettings(await readBody(request));
      json(response, 200, publicStatus());
    } catch (error) {
      json(response, 400, { error: error.message });
    }
    return;
  }
  if (request.method === "POST" && url.pathname === "/v1/sync-result") {
    try {
      const result = await readBody(request);
      if (!state.sync || result.key !== state.sync.key) {
        json(response, 409, { error: "This sync request is no longer current." });
        return;
      }
      if (result.success) {
        state.lastSync = {
          at: Date.now(),
          bio: state.sync.bio,
          track: state.sync.track
        };
        state.sync = null;
        state.lastError = null;
      } else {
        state.lastError = result.error || "Opera could not update the TikTok bio.";
      }
      json(response, 200, publicStatus());
    } catch (error) {
      json(response, 400, { error: error.message });
    }
    return;
  }
  if (request.method === "GET" && url.pathname === "/auth/spotify/start") {
    if (!settings.clientId) {
      text(response, 400, "Add your Spotify Client ID in local setup before connecting.");
      return;
    }
    const verifier = randomUrlSafe(64);
    const stateValue = randomUrlSafe(32);
    oauth = { verifier, state: stateValue };
    const parameters = new URLSearchParams({
      client_id: settings.clientId,
      response_type: "code",
      redirect_uri: CALLBACK_URL,
      code_challenge_method: "S256",
      code_challenge: codeChallenge(verifier),
      scope: "user-read-currently-playing",
      state: stateValue
    });
    response.writeHead(302, { Location: SPOTIFY_AUTHORIZE_URL + "?" + parameters.toString() });
    response.end();
    return;
  }
  if (request.method === "GET" && url.pathname === "/auth/spotify/callback") {
    try {
      if (url.searchParams.get("error")) throw new Error("Spotify login was cancelled: " + url.searchParams.get("error"));
      if (!oauth || url.searchParams.get("state") !== oauth.state) throw new Error("Spotify login could not be verified.");
      await exchangeAuthorizationCode(url.searchParams.get("code"));
      text(response, 200, "<!doctype html><title>BioSync connected</title><body style='font-family:system-ui;background:#101114;color:#f6f4ef;padding:48px'><h1>Spotify connected</h1><p>Return to the BioSync local setup page, then enable automatic sync in Opera.</p></body>", "text/html; charset=utf-8");
    } catch (error) {
      text(response, 400, "<!doctype html><title>BioSync error</title><body style='font-family:system-ui;padding:48px'><h1>Spotify was not connected</h1><p>" + String(error.message).replace(/</g, "&lt;") + "</p></body>", "text/html; charset=utf-8");
    }
    return;
  }

  text(response, 404, "Not found.");
});

server.listen(PORT, HOST, () => {
  console.log("BioSync local companion is running at http://" + HOST + ":" + PORT);
  console.log("Spotify callback URI: " + CALLBACK_URL);
  console.log("Tokens remain in memory and are cleared when this process stops.");
  inspectSpotify();
  setInterval(inspectSpotify, 15000);
});