(() => {
  "use strict";

  const wait = (finder, timeout) => new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      const value = finder();
      if (value) {
        window.clearInterval(timer);
        resolve(value);
        return;
      }

      if (Date.now() - startedAt > (timeout || 9000)) {
        window.clearInterval(timer);
        reject(new Error("TikTok's profile editor was not found. Open your profile page and try again."));
      }
    }, 160);
  });

  function isVisible(element) {
    if (!element) return false;
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
  }

  function normalise(value) {
    return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  function byButtonText(phrases) {
    return Array.from(document.querySelectorAll("button, [role='button'], a"))
      .find((element) => isVisible(element) && phrases.includes(normalise(element.textContent)));
  }

  function findEditProfileButton() {
    return byButtonText(["edit profile", "edit profile information"]);
  }

  function findBioInput() {
    const controls = Array.from(document.querySelectorAll("textarea, input, [contenteditable='true']"));
    return controls.find((element) => {
      if (!isVisible(element)) return false;
      const label = normalise([
        element.getAttribute("aria-label"),
        element.getAttribute("placeholder"),
        element.getAttribute("name"),
        element.id
      ].filter(Boolean).join(" "));
      return label.includes("bio");
    }) || controls.find((element) => isVisible(element) && element.tagName === "TEXTAREA");
  }

  function setValue(element, value) {
    if (element.isContentEditable) {
      element.focus();
      element.textContent = value;
      element.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        inputType: "insertText",
        data: value
      }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }

    const prototype = element.tagName === "TEXTAREA"
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value").set;
    setter.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    element.dispatchEvent(new Event("blur", { bubbles: true }));
  }

  function findSaveButton() {
    return byButtonText(["save"]);
  }

  async function updateBio(bio) {
    if (!/^https:\/\/www\.tiktok\.com\//.test(window.location.href)) {
      throw new Error("BioSync can only update a TikTok tab.");
    }

    const editButton = await wait(findEditProfileButton);
    editButton.click();

    const input = await wait(findBioInput);
    setValue(input, bio);

    const saveButton = await wait(findSaveButton);
    saveButton.click();

    await new Promise((resolve) => window.setTimeout(resolve, 900));

    return { ok: true };
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.type !== "biosync-update-bio") {
      return;
    }

    updateBio(message.bio)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({
        ok: false,
        error: error && error.message ? error.message : "TikTok did not accept the update."
      }));

    return true;
  });
})();