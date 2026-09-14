const COMPANION_ORIGIN = "http://127.0.0.1:38473";
const POLL_ALARM = "biosync-poll";
const STATUS_KEY = "biosync-status";
const ENABLED_KEY = "biosync-extension-enabled";
const ATTEMPT_KEY = "biosync-last-attempt";

async function api(path, options) {
  const response = await fetch(COMPANION_ORIGIN + path, {
    headers: { "Content-Type": "application/json" },
    ...(options || {})
  });

  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch (error) {
    throw new Error("The local BioSync companion returned an invalid response.");
  }

  if (!response.ok) {
    throw new Error(data.error || "The local BioSync companion could not complete the request.");
  }

  return data;
}

async function getEnabled() {
  const value = await chrome.storage.local.get(ENABLED_KEY);
  return Boolean(value[ENABLED_KEY]);
}

async function setExtensionStatus(status) {
  await chrome.storage.local.set({ [STATUS_KEY]: status });
}

async function getExtensionStatus() {
  const value = await chrome.storage.local.get(STATUS_KEY);
  return value[STATUS_KEY] || {
    connected: false,
    message: "Waiting for the local companion."
  };
}

function createAlarm() {
  chrome.alarms.create(POLL_ALARM, { periodInMinutes: 1 });
}

async function findTikTokTab() {
  const tabs = await chrome.tabs.query({ url: "https://www.tiktok.com/*" });
  return tabs.find((tab) => Number.isInteger(tab.id));
}

async function reportSync(result) {
  return api("/v1/sync-result", {
    method: "POST",
    body: JSON.stringify(result)
  });
}

async function attemptSync(sync) {
  const tab = await findTikTokTab();
  if (!tab || !tab.id) {
    await setExtensionStatus({
      connected: true,
      message: "Open your TikTok profile in Opera, then BioSync will retry.",
      pendingBio: sync.bio
    });
    return;
  }

  const previous = await chrome.storage.local.get(ATTEMPT_KEY);
  const lastAttempt = previous[ATTEMPT_KEY];
  if (lastAttempt && lastAttempt.key === sync.key && Date.now() - lastAttempt.at < 55000) {
    return;
  }

  await chrome.storage.local.set({
    [ATTEMPT_KEY]: { key: sync.key, at: Date.now() }
  });

  try {
    const result = await chrome.tabs.sendMessage(tab.id, {
      type: "biosync-update-bio",
      bio: sync.bio,
      key: sync.key
    });

    if (!result || !result.ok) {
      throw new Error((result && result.error) || "TikTok's profile editor could not be reached.");
    }

    await reportSync({
      key: sync.key,
      bio: sync.bio,
      success: true
    });

    await setExtensionStatus({
      connected: true,
      message: "TikTok bio synced.",
      lastSyncAt: Date.now(),
      lastBio: sync.bio
    });
  } catch (error) {
    const message = error && error.message
      ? error.message
      : "BioSync could not update TikTok.";

    await reportSync({
      key: sync.key,
      bio: sync.bio,
      success: false,
      error: message
    }).catch(() => undefined);

    await setExtensionStatus({
      connected: true,
      message,
      pendingBio: sync.bio,
      error: true
    });
  }
}

async function pollCompanion() {
  try {
    const status = await api("/v1/status");
    const enabled = await getEnabled();

    await setExtensionStatus({
      connected: true,
      enabled,
      message: status.message || (enabled ? "Watching Spotify for a stable track." : "Automatic sync is paused."),
      nowPlaying: status.nowPlaying || null,
      pendingBio: status.sync && status.sync.bio ? status.sync.bio : null,
      lastSync: status.lastSync || null,
      companion: status
    });

    if (enabled && status.sync && status.sync.ready && status.sync.bio && status.sync.key) {
      await attemptSync(status.sync);
    }
  } catch (error) {
    await setExtensionStatus({
      connected: false,
      message: "Start the local BioSync companion to connect Opera.",
      error: true
    });
  }
}

async function openTikTokProfile() {
  const tab = await findTikTokTab();
  if (tab && tab.id) {
    await chrome.tabs.update(tab.id, { active: true });
    return;
  }
  await chrome.tabs.create({ url: "https://www.tiktok.com/" });
}

chrome.runtime.onInstalled.addListener(() => {
  createAlarm();
  chrome.storage.local.set({ [ENABLED_KEY]: false });
  pollCompanion();
});

chrome.runtime.onStartup.addListener(() => {
  createAlarm();
  pollCompanion();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === POLL_ALARM) {
    pollCompanion();
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) {
    return;
  }

  if (message.type === "biosync-get-status") {
    Promise.all([getExtensionStatus(), getEnabled()]).then(([status, enabled]) => {
      sendResponse({ ...status, enabled });
    });
    return true;
  }

  if (message.type === "biosync-toggle") {
    chrome.storage.local.set({ [ENABLED_KEY]: Boolean(message.enabled) })
      .then(async () => {
        await pollCompanion();
        sendResponse({ ok: true });
      })
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "biosync-refresh") {
    pollCompanion()
      .then(() => getExtensionStatus())
      .then((status) => sendResponse({ ok: true, status }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "biosync-open-setup") {
    chrome.tabs.create({ url: COMPANION_ORIGIN + "/" })
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "biosync-open-tiktok") {
    openTikTokProfile()
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
});