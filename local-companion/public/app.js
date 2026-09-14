const $ = (id) => document.getElementById(id);
let clientIdConfigured = false;

async function request(path, options) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...(options || {})
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "BioSync request failed.");
  return data;
}

function render(status) {
  $("connection").textContent = status.connected ? "SPOTIFY CONNECTED" : "NOT CONNECTED";
  $("connection").classList.toggle("live", Boolean(status.connected));
  $("message").textContent = status.message || "";
  $("track").textContent = status.nowPlaying
    ? status.nowPlaying.name + " — " + status.nowPlaying.artist
    : "Nothing playing";

  const sync = status.sync && status.sync.ready
    ? "Ready to sync: " + status.sync.bio
    : status.lastSync
      ? "Last synced: " + status.lastSync.bio
      : "No update is queued.";
  $("sync").textContent = sync;

  const config = status.settings || {};
  $("base-bio").value = config.baseBio || "";
  $("template").value = config.template || "🎧 {track} — {artist}";
  $("max-length").value = config.maxLength || 80;
  $("stable-seconds").value = config.stableSeconds || 25;
  clientIdConfigured = Boolean(status.configured);
  if (!clientIdConfigured) $("client-id").value = "";
}

async function refresh() {
  try {
    render(await request("/v1/status"));
  } catch (error) {
    $("message").textContent = error.message;
  }
}

$("save").addEventListener("click", async () => {
  try {
    const status = await request("/v1/settings", {
      method: "POST",
      body: JSON.stringify({
        ...( $("client-id").value.trim() ? { clientId: $("client-id").value.trim() } : {} ),
        baseBio: $("base-bio").value,
        template: $("template").value,
        maxLength: Number($("max-length").value),
        stableSeconds: Number($("stable-seconds").value)
      })
    });
    render(status);
    $("message").textContent = "Settings saved. Connect Spotify when ready.";
  } catch (error) {
    $("message").textContent = error.message;
  }
});

refresh();
setInterval(refresh, 5000);