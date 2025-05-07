// ==UserScript==
// @name         Bing Rewards Point Breakdown Notifier
// @namespace    http://tampermonkey.net/
// @version      0.4 // Incremented version
// @description  Extracts PC and Mobile points from Bing Rewards points breakdown page and sends a Pushover notification. Keys are configurable.
// @author       Joao
// @match        https://rewards.bing.com/pointsbreakdown*
// @grant        GM.xmlHttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @connect      api.pushover.net
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    // Constants for storage keys
    const PUSHOVER_USER_KEY_STORAGE_ID = "pushoverUserKey_PointsNotifier";
    const PUSHOVER_API_TOKEN_STORAGE_ID = "pushoverApiToken_PointsNotifier";

    let configuredUserKey = null;
    let configuredApiToken = null;

    // --- Configuration Function ---
    function getConfiguredKey(storageId, promptMessage, isSensitive = false) {
        let keyValue = GM_getValue(storageId, null);
        if (!keyValue) {
            keyValue = prompt(promptMessage);
            if (keyValue && keyValue.trim() !== "") {
                GM_setValue(storageId, keyValue.trim());
                alert( (isSensitive ? "Token" : "Key") + " saved. You may need to reload for it to take effect if this is the first time.");
            } else {
                alert("Configuration for '" + (isSensitive ? "Token" : "Key") + "' is required. Script cannot send notifications without it.");
                return null;
            }
        }
        return keyValue;
    }

    function initializeKeys() {
        configuredUserKey = getConfiguredKey(PUSHOVER_USER_KEY_STORAGE_ID, "Pushover Notifier: Please enter your Pushover User Key:");
        if (!configuredUserKey) return false; // Stop if first key fails

        configuredApiToken = getConfiguredKey(PUSHOVER_API_TOKEN_STORAGE_ID, "Pushover Notifier: Please enter your Pushover Application API Token:", true);
        if (!configuredApiToken) return false; // Stop if second key fails

        return true;
    }

    // --- Pushover Notification Function ---
    // Now accepts userKey and apiToken as arguments
    function sendPushoverNotification(userKey, apiToken, message, title = "Bing Rewards Update") {
        if (!userKey || !apiToken) {
            console.error("Pushover User Key or API Token is missing. Cannot send notification. Please configure them via the script menu.");
            // Alerting here might be too noisy if called frequently without keys
            // alert("Pushover keys not configured. Please use the script menu command to set them.");
            return;
        }

        const pushoverUrl = "https://api.pushover.net/1/messages.json";
        const params = new URLSearchParams();
        params.append("token", apiToken);
        params.append("user", userKey);
        params.append("message", message);
        if (title) {
            params.append("title", title);
        }

        console.log("Attempting to send Pushover notification:", title, "-", message);

        GM.xmlHttpRequest({
            method: "POST",
            url: pushoverUrl,
            data: params.toString(),
            headers: {
                "Content-Type": "application/x-www-form-urlencoded"
            },
            onload: function(response) {
                if (response.status === 200) {
                    try {
                        const responseData = JSON.parse(response.responseText);
                        if (responseData.status === 1) {
                            console.log("Pushover notification sent successfully! Request ID:", responseData.request);
                        } else {
                            console.error("Pushover API reported an error:", responseData.errors);
                            alert("Pushover API Error: " + responseData.errors.join(", ") + "\nCheck your keys or the Pushover status.");
                        }
                    } catch (e) {
                        console.error("Error parsing Pushover response JSON:", e);
                        alert("Error parsing Pushover response. Check console.");
                    }
                } else {
                    console.error("Pushover request failed with HTTP status:", response.status);
                    alert("Pushover request failed. HTTP Status: " + response.status + ". Check API token/user key, and console.");
                }
            },
            onerror: function(response) {
                console.error("Pushover request network error:", response);
                alert("Pushover request network error. Check console and network connection.");
            }
        });
    }

    // --- Point Extraction Logic (remains the same) ---
    function extractPointsData() {
        const pointsCards = document.querySelectorAll('.pointsBreakdownCard');
        let pcPoints = null;
        let mobilePoints = null;

        pointsCards.forEach(card => {
            const titleElement = card.querySelector('.pointsDetail .title-detail p a');
            const pointsProgressElement = card.querySelector('.pointsDetail .title-detail p.pointsDetail b');

            if (titleElement && pointsProgressElement) {
                const titleText = titleElement.textContent.trim().toLowerCase();
                const pointsText = pointsProgressElement.textContent.trim();

                if (titleText.includes("pc search")) {
                    pcPoints = pointsText;
                } else if (titleText.includes("mobile search")) {
                    mobilePoints = pointsText;
                }
            }
        });
        return { pcPoints, mobilePoints };
    }

    // --- Main Logic: Wait for elements and process ---
    function waitForElementsAndProcess() {
        // First, ensure keys are configured or prompt for them
        if (!initializeKeys()) {
            console.warn("Pushover keys not configured. Script will not send notifications until keys are set via the menu command.");
            // No need to alert here, initializeKeys already does if input is cancelled/empty
            return; // Stop processing if keys aren't set up
        }

        const maxWaitTime = 30000;
        const checkInterval = 500;
        let elapsedTime = 0;
        let notificationSentThisSession = false;

        const intervalId = setInterval(() => {
            elapsedTime += checkInterval;
            const cards = document.querySelectorAll('.pointsBreakdownCard');

            if (cards.length >= 2 && !notificationSentThisSession) {
                const { pcPoints, mobilePoints } = extractPointsData();

                if (pcPoints !== null && mobilePoints !== null) {
                    clearInterval(intervalId);
                    notificationSentThisSession = true;

                    const lastNotificationKey = "lastPointsNotification_PointsNotifier";
                    const currentPointsString = `PC:${pcPoints},Mobile:${mobilePoints}`;
                    const lastPointsString = GM_getValue(lastNotificationKey, "");

                    if (currentPointsString === lastPointsString) {
                        console.log("Points are the same as last notification. Skipping Pushover.");
                        return;
                    }

                    const message = `PC Search: ${pcPoints} points\nMobile Search: ${mobilePoints} points`;
                    // Pass the configured keys to sendPushoverNotification
                    sendPushoverNotification(configuredUserKey, configuredApiToken, message, "Bing Points Update");
                    GM_setValue(lastNotificationKey, currentPointsString);

                } else if (elapsedTime >= maxWaitTime) {
                    clearInterval(intervalId);
                    console.warn("Timed out: Cards were found, but could not extract both PC and Mobile points within time. Partial data:", { pcPoints, mobilePoints });
                }
            } else if (elapsedTime >= maxWaitTime) {
                clearInterval(intervalId);
                if (!notificationSentThisSession) {
                    console.warn("Timed out waiting for sufficient point breakdown cards to populate or for parsing to succeed.");
                }
            }
        }, checkInterval);
    }

    // --- Script Menu Command for Reconfiguration ---
    function reconfigurePushoverKeys() {
        alert("You will be prompted to re-enter your Pushover User Key and API Token.");
        // Clear existing stored values so getConfiguredKey prompts again
        GM_setValue(PUSHOVER_USER_KEY_STORAGE_ID, null);
        GM_setValue(PUSHOVER_API_TOKEN_STORAGE_ID, null);

        if (initializeKeys()) {
            alert("Pushover keys reconfigured successfully.");
        } else {
            alert("Pushover key reconfiguration was cancelled or failed. Previous valid keys (if any) might still be in use until next full script reload, or new prompts will appear.");
        }
        // Optional: Suggest a page reload if settings need to be immediately active for a running instance
        // if (confirm("Reload page to apply new keys immediately?")) { window.location.reload(); }
    }

    // Register the menu command
    if (typeof GM_registerMenuCommand === "function") {
        GM_registerMenuCommand("Configure Pushover Keys (Points Notifier)", reconfigurePushoverKeys, "c");
    }


    // --- Start the process ---
    console.log("Bing Rewards Point Breakdown Notifier script started.");
    // The keys will be checked/prompted inside waitForElementsAndProcess
    waitForElementsAndProcess();

})();