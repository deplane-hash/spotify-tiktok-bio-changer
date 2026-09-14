(() => {
  "use strict";

  const SPOTIFY_AUTHORIZE_URL = "https://accounts.spotify.com/authorize";
  const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
  const SPOTIFY_API_URL = "https://api.spotify.com/v1";
  const SCOPES = "user-read-currently-playing user-read-private";
  const POLL_INTERVAL_MS = 30000;
  const DEFAULT_LIMIT = 80;

  const STORAGE = {
    config: "biosync.config",
    accessToken: "biosync.access_token",
    refreshToken: "biosync.refresh_token",
    expiresAt: "biosync.expires_at",
    verifier: "biosync.pkce_verifier",
    oauthState: "biosync.oauth_state"
  };

  const state = {
    accessToken: null,
    refreshToken: null,
    expiresAt: 0,
    current: null,
    pollTimer: null,
    busy: false
  };

  const $ = (id) => document.getElementById(id);

  function getConfig() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE.config) || "{}");
    } catch (error) {
      return {};
    }
  }

  function saveConfig() {
    const config = {
      clientId: $("client-id").value.trim(),
      template: $("template").value,
      maxLength: Number($("max-length").value) || DEFAULT_LIMIT
    };
    localStorage.setItem(STORAGE.config, JSON.stringify(config));
    return config;
  }

  function redirectUri() {
    return window.location.origin + window.location.pathname;
  }

  function setMessage(id, message, kind) {
    const element = $(id);
    element.textContent = message || "";
    element.classList.toggle("error", kind === "error");
    element.classList.toggle("success", kind === "success");
  }

  function setConnectionBadge(connected) {
    const badge = $("connection-badge");
    badge.textContent = connected ? "CONNECTED" : "NOT CONNECTED";
    badge.classList.toggle("badge-live", connected);
    badge.classList.toggle("badge-muted", !connected);
  }

  function randomString(length) {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (value) => alphabet[value % alphabet.length]).join("");
  }

  async function sha256(value) {
    return crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  }

  function base64Url(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function storeTokenResponse(data) {
    state.accessToken = data.access_token;
    state.refreshToken = data.refresh_token || state.refreshToken;
    state.expiresAt = Date.now() + (Number(data.expires_in || 3600) * 1000);
    sessionStorage.setItem(STORAGE.accessToken, state.accessToken);
    if (state.refreshToken) sessionStorage.setItem(STORAGE.refreshToken, state.refreshToken);
    sessionStorage.setItem(STORAGE.expiresAt, String(state.expiresAt));
  }

  function clearSession() {
    state.accessToken = null;
    state.refreshToken = null;
    state.expiresAt = 0;
    state.current = null;
    [STORAGE.accessToken, STORAGE.refreshToken, STORAGE.expiresAt, STORAGE.verifier, STORAGE.oauthState]
      .forEach((key) => sessionStorage.removeItem(key));
    stopPolling();
  }

  async function beginLogin() {
    const config = saveConfig();
    if (!config.clientId) {
      setMessage("setup-help", "Add your Spotify Client ID first.", "error");
      $("client-id").focus();
      return;
    }

    if (!window.isSecureContext && window.location.hostname !== "127.0.0.1") {
      setMessage("setup-help", "Spotify requires HTTPS for hosted apps. Use 127.0.0.1 for local development.", "error");
      return;
    }

    const verifier = randomString(64);
    const challenge = base64Url(await sha256(verifier));
    const oauthState = randomString(32);
    sessionStorage.setItem(STORAGE.verifier, verifier);
    sessionStorage.setItem(STORAGE.oauthState, oauthState);

    const params = new URLSearchParams({
      client_id: config.clientId,
      response_type: "code",
      redirect_uri: redirectUri(),
      code_challenge_method: "S256",
      code_challenge: challenge,
      state: oauthState,
      scope: SCOPES
    });
    window.location.assign(SPOTIFY_AUTHORIZE_URL + "?" + params.toString());
  }

  async function exchangeCode(code) {
    const config = getConfig();
    const verifier = sessionStorage.getItem(STORAGE.verifier);
    if (!config.clientId || !verifier) throw new Error("Your login session expired. Start the Spotify connection again.");

    const response = await fetch(SPOTIFY_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.clientId,
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri(),
        code_verifier: verifier
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error_description || "Spotify could not complete the login.");

    storeTokenResponse(data);
    sessionStorage.removeItem(STORAGE.verifier);
    sessionStorage.removeItem(STORAGE.oauthState);
  }

  async function refreshAccessToken() {
    const config = getConfig();
    const refreshToken = state.refreshToken || sessionStorage.getItem(STORAGE.refreshToken);
    if (!config.clientId || !refreshToken) throw new Error("Spotify login has expired. Please connect again.");

    const response = await fetch(SPOTIFY_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.clientId,
        grant_type: "refresh_token",
        refresh_token: refreshToken
      })
    });
    const data = await response.json();
    if (!response.ok) {
      clearSession();
      throw new Error(data.error_description || "Spotify login has expired. Please connect again.");
    }
    storeTokenResponse(data);
  }

  async function apiFetch(path) {
    if (!state.accessToken) throw new Error("Connect Spotify to continue.");

    if (state.expiresAt && Date.now() > state.expiresAt - 45000) await refreshAccessToken();

    let response = await fetch(SPOTIFY_API_URL + path, {
      headers: { Authorization: "Bearer " + state.accessToken }
    });

    if (response.status === 401 && state.refreshToken) {
      await refreshAccessToken();
      response = await fetch(SPOTIFY_API_URL + path, {
        headers: { Authorization: "Bearer " + state.accessToken }
      });
    }
    return response;
  }

  function currentTemplate() {
    const config = getConfig();
    return config.template || $("template").value;
  }

  function maxLength() {
    const value = Number($("max-length").value);
    return Math.min(150, Math.max(10, Number.isFinite(value) ? value : DEFAULT_LIMIT));
  }

  function codePointLength(value) {
    return Array.from(value).length;
  }

  function truncate(value, limit) {
    const characters = Array.from(value);
    if (characters.length <= limit) return value;
    if (limit <= 1) return characters.slice(0, limit).join("");
    return characters.slice(0, limit - 1).join("") + "…";
  }

  function generatedBio() {
    if (!state.current || !state.current.item || state.current.item.type !== "track") return "";
    const item = state.current.item;
    const artist = (item.artists || []).map((entry) => entry.name).filter(Boolean).join(", ");
    const raw = currentTemplate()
      .replaceAll("{track}", item.name || "Unknown track")
      .replaceAll("{artist}", artist || "Unknown artist")
      .replace(/\s+/g, " ")
      .trim();
    return truncate(raw, maxLength());
  }

  function updateBioPreview() {
    const bio = generatedBio();
    const limit = maxLength();
    const rawLength = state.current && state.current.item ? codePointLength(
      currentTemplate()
        .replaceAll("{track}", state.current.item.name || "")
        .replaceAll("{artist}", (state.current.item.artists || []).map((entry) => entry.name).join(", "))
    ) : 0;

    $("bio-preview").textContent = bio || "Connect Spotify to generate a bio.";
    $("bio-count").textContent = codePointLength(bio) + " / " + limit;
    $("bio-warning").classList.toggle("hidden", !rawLength || rawLength <= limit);
    $("bio-warning").textContent = rawLength > limit ? "Trimmed to fit the selected limit." : "";
    $("copy-bio").disabled = !bio;
  }

  function renderTrack() {
    const current = state.current;
    const item = current && current.item;

    if (!item || item.type !== "track") {
      $("playback-label").textContent = current && current.unsupported ? "NOT A TRACK" : "WAITING FOR PLAYBACK";
      $("track-title").textContent = current && current.unsupported ? "This is not a music track" : "Nothing playing yet";
      $("track-artist").textContent = current && current.unsupported ? "Start a song instead of a podcast or audiobook." : "Start a song on Spotify and refresh.";
      $("track-album").textContent = "";
      $("track-link").classList.add("hidden");
      $("album-art").classList.add("hidden");
      $("album-placeholder").classList.remove("hidden");
      updateBioPreview();
      return;
    }

    const artist = (item.artists || []).map((entry) => entry.name).filter(Boolean).join(", ");
    const image = item.album && item.album.images && item.album.images[0];
    $("playback-label").textContent = current.is_playing ? "NOW PLAYING" : "PAUSED ON SPOTIFY";
    $("track-title").textContent = item.name || "Untitled track";
    $("track-artist").textContent = artist || "Unknown artist";
    $("track-album").textContent = item.album && item.album.name ? item.album.name : "";
    $("track-link").href = item.external_urls && item.external_urls.spotify ? item.external_urls.spotify : "#";
    $("track-link").classList.toggle("hidden", !item.external_urls || !item.external_urls.spotify);

    if (image && image.url) {
      $("album-art").src = image.url;
      $("album-art").alt = "Album artwork for " + (item.album.name || item.name);
      $("album-art").classList.remove("hidden");
      $("album-placeholder").classList.add("hidden");
    } else {
      $("album-art").classList.add("hidden");
      $("album-placeholder").classList.remove("hidden");
    }
    updateBioPreview();
  }

  function renderConnected() {
    $("app-panel").classList.remove("hidden");
    setConnectionBadge(true);
    setMessage("setup-help", "Connected. Your current playback is read only.", "success");
  }

  async function refreshTrack() {
    if (!state.accessToken || state.busy) return;

    state.busy = true;
    $("refresh-button").disabled = true;
    $("app-status").textContent = "Checking Spotify playback…";

    try {
      const response = await apiFetch("/me/player/currently-playing?additional_types=track,episode");

      if (response.status === 204) {
        state.current = null;
        renderTrack();
        $("app-status").textContent = "Spotify is not reporting an active track. Play something and refresh.";
        return;
      }

      if (response.status === 429) {
        const retryAfter = response.headers.get("Retry-After") || "a few";
        $("app-status").textContent = "Spotify asked us to slow down. Try again in " + retryAfter + " seconds.";
        return;
      }

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error && data.error.message ? data.error.message : "Spotify playback could not be read.");
      }

      const data = await response.json();
      state.current = {
        item: data.item || null,
        is_playing: Boolean(data.is_playing),
        unsupported: Boolean(data.item && data.item.type !== "track")
      };
      renderTrack();
      $("app-status").textContent = state.current.item && state.current.item.type === "track"
        ? "Updated just now. We check again every 30 seconds."
        : "No music track is active right now.";
    } catch (error) {
      if (error.message.toLowerCase().includes("expired") || error.message.toLowerCase().includes("login")) {
        clearSession();
        $("app-panel").classList.add("hidden");
        setConnectionBadge(false);
      }
      $("app-status").textContent = error.message;
      setMessage("setup-help", error.message, "error");
    } finally {
      state.busy = false;
      $("refresh-button").disabled = false;
    }
  }

  function startPolling() {
    stopPolling();
    state.pollTimer = window.setInterval(refreshTrack, POLL_INTERVAL_MS);
  }

  function stopPolling() {
    if (state.pollTimer) {
      window.clearInterval(state.pollTimer);
      state.pollTimer = null;
    }
  }

  async function copyText(value) {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      return;
    }

    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }

  async function copyBio() {
    const bio = generatedBio();
    if (!bio) {
      setMessage("copy-message", "There is no track to copy yet.", "error");
      return;
    }

    try {
      await copyText(bio);
      setMessage("copy-message", "Copied. Paste it into TikTok → Profile → Edit profile.", "success");
      const button = $("copy-bio");
      const original = button.innerHTML;
      button.innerHTML = "Copied ✓";
      window.setTimeout(() => { button.innerHTML = original; }, 1600);
    } catch (error) {
      setMessage("copy-message", "Clipboard access was blocked. Select the preview text and copy it manually.", "error");
    }
  }

  async function copyRedirect() {
    try {
      await copyText(redirectUri());
      setMessage("setup-help", "Redirect URI copied. Add that exact value to your Spotify app.", "success");
    } catch (error) {
      setMessage("setup-help", "Select the redirect URI and copy it manually.", "error");
    }
  }

  function handleDisconnect() {
    clearSession();
    $("app-panel").classList.add("hidden");
    setConnectionBadge(false);
    setMessage("setup-help", "Disconnected. Your Spotify tokens were removed from this browser session.", "success");
  }

  async function handleCallback() {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const oauthError = params.get("error");

    if (!code && !oauthError) return false;
    window.history.replaceState({}, document.title, redirectUri());

    if (oauthError) {
      setMessage("setup-help", "Spotify login was cancelled: " + oauthError + ".", "error");
      return true;
    }

    const expectedState = sessionStorage.getItem(STORAGE.oauthState);
    if (!expectedState || params.get("state") !== expectedState) {
      setMessage("setup-help", "Login could not be verified. Start the Spotify connection again.", "error");
      return true;
    }

    try {
      setMessage("setup-help", "Finishing Spotify connection…");
      await exchangeCode(code);
      renderConnected();
      await refreshTrack();
      startPolling();
    } catch (error) {
      setMessage("setup-help", error.message, "error");
    }
    return true;
  }

  async function restoreSession() {
    const config = getConfig();
    state.accessToken = sessionStorage.getItem(STORAGE.accessToken);
    state.refreshToken = sessionStorage.getItem(STORAGE.refreshToken);
    state.expiresAt = Number(sessionStorage.getItem(STORAGE.expiresAt) || 0);

    if (!config.clientId || !state.accessToken) return;

    try {
      if (state.expiresAt && Date.now() > state.expiresAt - 45000) await refreshAccessToken();
      renderConnected();
      await refreshTrack();
      startPolling();
    } catch (error) {
      clearSession();
      setMessage("setup-help", error.message, "error");
    }
  }

  function loadConfigIntoForm() {
    const config = getConfig();
    $("client-id").value = config.clientId || "";
    $("template").value = config.template || "🎧 {track} — {artist}";
    $("max-length").value = config.maxLength || DEFAULT_LIMIT;
    $("redirect-uri").textContent = redirectUri();
    updateBioPreview();
  }

  function bindEvents() {
    $("setup-form").addEventListener("submit", (event) => {
      event.preventDefault();
      beginLogin().catch((error) => setMessage("setup-help", error.message, "error"));
    });
    $("template").addEventListener("change", () => { saveConfig(); updateBioPreview(); });
    $("max-length").addEventListener("input", () => { saveConfig(); updateBioPreview(); });
    $("refresh-button").addEventListener("click", refreshTrack);
    $("copy-bio").addEventListener("click", copyBio);
    $("copy-redirect").addEventListener("click", copyRedirect);
    $("open-tiktok").addEventListener("click", () => { window.open("https://www.tiktok.com/", "_blank", "noopener,noreferrer"); });
    $("disconnect-button").addEventListener("click", handleDisconnect);

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) stopPolling();
      else if (state.accessToken) { refreshTrack(); startPolling(); }
    });
  }

  async function boot() {
    loadConfigIntoForm();
    bindEvents();
    setConnectionBadge(false);
    const callbackHandled = await handleCallback();
    if (!callbackHandled) await restoreSession();
  }

  boot();
})();