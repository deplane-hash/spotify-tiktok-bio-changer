const $ = (id) => document.getElementById(id);

function send(type, payload) {
  return chrome.runtime.sendMessage({ type, ...(payload || {}) });
}

function setText(id, value) {
  $(id).textContent = value || "";
}

function render(status) {
  const connected = Boolean(status && status.connected);
  $("connection").classList.toggle("offline", !connected);
  $("connection").classList.toggle("online", connected);
  $("enabled").checked = Boolean(status && status.enabled);

  setText("message", status && status.message ? status.message : "Start the local companion.");
  const nowPlaying = status && status.nowPlaying;
  setText("track", nowPlaying && nowPlaying.name ? nowPlaying.name : "Nothing detected");
  setText("artist", nowPlaying && nowPlaying.artist ? nowPlaying.artist : "Connect Spotify in local setup.");

  const pending = status && status.pendingBio;
  $("pending-wrap").classList.toggle("hidden", !pending);
  setText("pending", pending || "");
}

async function refresh() {
  const response = await send("biosync-refresh");
  if (!response || !response.ok) {
    render({
      connected: false,
      message: response && response.error ? response.error : "The companion could not be reached."
    });
    return;
  }
  const status = await send("biosync-get-status");
  render(status);
}

document.addEventListener("DOMContentLoaded", async () => {
  render(await send("biosync-get-status"));

  $("enabled").addEventListener("change", async (event) => {
    const response = await send("biosync-toggle", { enabled: event.target.checked });
    if (!response || !response.ok) {
      event.target.checked = false;
    }
    await refresh();
  });

  $("setup").addEventListener("click", () => send("biosync-open-setup"));
  $("tiktok").addEventListener("click", () => send("biosync-open-tiktok"));
  $("refresh").addEventListener("click", refresh);

  await refresh();
});