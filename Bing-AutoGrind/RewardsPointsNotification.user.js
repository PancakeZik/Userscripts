// ==UserScript==
// @name         Bing Rewards Point Breakdown Notifier
// @namespace    http://tampermonkey.net/
// @version      0.5 // Incremented version
// @description  Extracts PC and Mobile points, account name, from Bing Rewards page and sends a Pushover notification. Keys are configurable.
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

    // Constants for storage keys (remain the same)
    const PUSHOVER_USER_KEY_STORAGE_ID = "pushoverUserKey_PointsNotifier";
    const PUSHOVER_API_TOKEN_STORAGE_ID = "pushoverApiToken_PointsNotifier";

    let configuredUserKey = null;
    let configuredApiToken = null;

    // Configuration Function (remains the same)
    function getConfiguredKey(storageId, promptMessage, isSensitive = false) {
        // ... (same as before)
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
        // ... (same as before)
        configuredUserKey = getConfiguredKey(PUSHOVER_USER_KEY_STORAGE_ID, "Pushover Notifier: Please enter your Pushover User Key:");
        if (!configuredUserKey) return false;

        configuredApiToken = getConfiguredKey(PUSHOVER_API_TOKEN_STORAGE_ID, "Pushover Notifier: Please enter your Pushover Application API Token:", true);
        if (!configuredApiToken) return false;

        return true;
    }

    // --- NEW: Function to get account name ---
    function getAccountFirstName() {
        const nameElement = document.getElementById("redirect_info_link");
        if (nameElement && nameElement.textContent) {
            const fullName = nameElement.textContent.trim();
            if (fullName) {
                return fullName.split(" ")[0]; // Get the first word
            }
        }
        return "Account"; // Default if name not found or empty
    }


    // --- Pushover Notification Function (remains largely the same) ---
    function sendPushoverNotification(userKey, apiToken, message, title = "Bing Rewards Update") {
        // ... (same as before, the message string itself will now contain the account name)
        if (!userKey || !apiToken) {
            console.error("Pushover User Key or API Token is missing. Cannot send notification. Please configure them via the script menu.");
            return;
        }

        const pushoverUrl = "https://api.pushover.net/1/messages.json";
        const params = new URLSearchParams();
        params.append("token", apiToken);
        params.append("user", userKey);
        params.append("message", message); // The message will now include the account name
        if (title) {
            params.append("title", title);
        }

        console.log("Attempting to send Pushover notification:", title, "-", message);

        GM.xmlHttpRequest({
            method: "POST",
            url: pushoverUrl,
            data: params.toString(),
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            onload: function(response) { /* ... same error handling ... */
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
            onerror: function(response) { /* ... same error handling ... */
                console.error("Pushover request network error:", response);
                alert("Pushover request network error. Check console and network connection.");
            }
        });
    }

    // --- Point Extraction Logic (remains the same) ---
    function extractPointsData() {
        // ... (same as before)
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
        if (!initializeKeys()) {
            console.warn("Pushover keys not configured. Script will not send notifications until keys are set via the menu command.");
            return;
        }

        // Get account name early (it should be available if other elements are)
        const accountFirstName = getAccountFirstName();
        console.log("Account Name Detected:", accountFirstName);


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

                    const lastNotificationKey = `lastPointsNotification_${accountFirstName}_PointsNotifier`; // Make storage key account-specific
                    const currentPointsString = `PC:${pcPoints},Mobile:${mobilePoints}`;
                    const lastPointsString = GM_getValue(lastNotificationKey, "");

                    if (currentPointsString === lastPointsString) {
                        console.log(`(${accountFirstName}) Points are the same as last notification. Skipping Pushover.`);
                        return;
                    }

                    // MODIFIED: Include account name in the message and title
                    const title = `Bing Points (${accountFirstName})`;
                    const message = `PC Search: ${pcPoints} pts\nMobile Search: ${mobilePoints} pts`;

                    sendPushoverNotification(configuredUserKey, configuredApiToken, message, title);
                    GM_setValue(lastNotificationKey, currentPointsString);

                } else if (elapsedTime >= maxWaitTime) {
                    clearInterval(intervalId);
                    console.warn(`(${accountFirstName}) Timed out: Cards were found, but could not extract both PC and Mobile points. Partial data:`, { pcPoints, mobilePoints });
                }
            } else if (elapsedTime >= maxWaitTime) {
                clearInterval(intervalId);
                if (!notificationSentThisSession) {
                    console.warn(`(${accountFirstName}) Timed out waiting for sufficient point breakdown cards or for parsing to succeed.`);
                }
            }
        }, checkInterval);
    }

    // --- Script Menu Command for Reconfiguration (remains the same) ---
    function reconfigurePushoverKeys() {
        // ... (same as before)
        alert("You will be prompted to re-enter your Pushover User Key and API Token.");
        GM_setValue(PUSHOVER_USER_KEY_STORAGE_ID, null);
        GM_setValue(PUSHOVER_API_TOKEN_STORAGE_ID, null);

        if (initializeKeys()) {
            alert("Pushover keys reconfigured successfully.");
        } else {
            alert("Pushover key reconfiguration was cancelled or failed. Previous valid keys (if any) might still be in use until next full script reload, or new prompts will appear.");
        }
    }

    if (typeof GM_registerMenuCommand === "function") {
        GM_registerMenuCommand("Configure Pushover Keys (Points Notifier)", reconfigurePushoverKeys, "c");
    }

    // --- Start the process ---
    console.log("Bing Rewards Point Breakdown Notifier script started.");
    waitForElementsAndProcess();

})();