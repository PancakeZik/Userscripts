// ==UserScript==
// @name         Bing Rewards Point Breakdown Notifier
// @namespace    http://tampermonkey.net/
// @version      0.8.1 // Incremented version
// @description  Extracts PC/Mobile points, daily set status, account name, from Bing Rewards and sends a Pushover notification.
// @author       Joao
// @match        https://rewards.bing.com/pointsbreakdown
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

    // Configuration Function
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
        if (!configuredUserKey) return false;

        configuredApiToken = getConfiguredKey(PUSHOVER_API_TOKEN_STORAGE_ID, "Pushover Notifier: Please enter your Pushover Application API Token:", true);
        if (!configuredApiToken) return false;

        return true;
    }

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

    function sendPushoverNotification(userKey, apiToken, message, title = "Bing Rewards Update") {
        if (!userKey || !apiToken) {
            console.error("Pushover User Key or API Token is missing. Cannot send notification. Please configure them via the script menu.");
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
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
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

    // --- Point Extraction Logic (for PC/Mobile points on /pointsbreakdown page) ---
    function extractPointsData() {
        const pointsCards = document.querySelectorAll('.pointsBreakdownCard');
        let pcPoints = null;
        let mobilePoints = null;

        if (pointsCards.length > 0) { // Only proceed if these cards exist
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
        }
        return { pcPoints, mobilePoints };
    }

    // --- Function to check Daily Set Completion ---
    function checkDailySetCompletion() {
        const allCardGroups = document.querySelectorAll('div.m-card-group');
        if (allCardGroups.length === 0) {
            return { total: 0, completed: 0, allAreCompleted: false, allThreeSpecificallyCompleted: false, statusString: "Daily Set: Card group not found." };
        }

        let targetCardGroup = null;
        for (let i = 0; i < allCardGroups.length; i++) {
            const currentGroup = allCardGroups[i];
            const firstDailySetItemIndicator = currentGroup.querySelector('mee-card mee-rewards-daily-set-item-content');
            if (firstDailySetItemIndicator) {
                const itemAttr = firstDailySetItemIndicator.getAttribute('item');
                if (itemAttr && itemAttr.startsWith('$ctrl.dailySets')) {
                    targetCardGroup = currentGroup;
                    break;
                }
            }
        }

        if (!targetCardGroup) {
            return { total: 0, completed: 0, allAreCompleted: false, allThreeSpecificallyCompleted: false, statusString: "Daily Set: Target group not found." };
        }

        const allMeeCardsInGroup = targetCardGroup.querySelectorAll('mee-card');
        const dailySetCards = Array.from(allMeeCardsInGroup).filter(
            (card) => {
                const dailySetContent = card.querySelector('mee-rewards-daily-set-item-content');
                if (dailySetContent) {
                    const itemAttr = dailySetContent.getAttribute('item');
                    return itemAttr && itemAttr.startsWith('$ctrl.dailySets');
                }
                return false;
            }
        );

        if (dailySetCards.length === 0) {
            // This means the identified target group didn't actually contain daily set items as expected
            return { total: 0, completed: 0, allAreCompleted: false, allThreeSpecificallyCompleted: false, statusString: "Daily Set: Items not found in target." };
        }

        let completedCount = 0;
        dailySetCards.forEach(card => {
            const checkMarkIcon = card.querySelector('mee-rewards-points span.mee-icon.mee-icon-SkypeCircleCheck');
            if (checkMarkIcon) {
                completedCount++;
            }
        });

        const totalItems = dailySetCards.length;
        const allThreeSpecificallyCompleted = (totalItems === 3 && completedCount === 3);
        const allFoundTasksAreCompleted = (totalItems > 0 && completedCount === totalItems);

        let statusString;
        if (totalItems === 0) { // Should be caught earlier, but as a fallback
            statusString = "Daily Set: No tasks found.";
        } else if (allThreeSpecificallyCompleted) {
            statusString = "Daily Set: All 3 completed! ✅";
        } else if (allFoundTasksAreCompleted) {
            statusString = `Daily Set: All ${completedCount}/${totalItems} tasks completed! ✅`;
            if (totalItems !== 3) { // Only show note if tasks were found AND not 3
                statusString += ` (Note: ${totalItems} daily tasks found)`;
            }
        } else {
            statusString = `Daily Set: ${completedCount}/${totalItems} tasks completed.`;
            if (totalItems !== 3) {
                statusString += ` (Note: ${totalItems} daily tasks found)`;
            }
        }

        return {
            total: totalItems,
            completed: completedCount,
            allAreCompleted: allFoundTasksAreCompleted,
            allThreeSpecificallyCompleted: allThreeSpecificallyCompleted,
            statusString: statusString
        };
    }


    // --- Main Logic: Wait for elements and process ---
    function waitForElementsAndProcess() {
        if (!initializeKeys()) {
            console.warn("Pushover keys not configured. Script will not send notifications until keys are set via the menu command.");
            return;
        }

        const accountFirstName = getAccountFirstName();
        console.log("Account Name Detected:", accountFirstName);

        const MAX_PC_POINTS = 90;
        const MAX_MOBILE_POINTS = 60;

        const maxWaitTime = 30000; // 30 seconds
        const checkInterval = 1000; // Check every 1 second
        let elapsedTime = 0;
        let notificationSentThisSession = false; // Reset per script run/page load.

        const intervalId = setInterval(() => {
            elapsedTime += checkInterval;

            const { pcPoints, mobilePoints } = extractPointsData();
            const dailySetStatus = checkDailySetCompletion();

            const dataFound = pcPoints !== null || mobilePoints !== null || dailySetStatus.total > 0;

            if (!dataFound && elapsedTime < maxWaitTime) {
                return; // Continue waiting if no data yet and not timed out
            }

            clearInterval(intervalId); // Stop interval, we'll make a decision now

            if (notificationSentThisSession) { // Should ideally not be hit if interval cleared, but as a safeguard
                return;
            }

            if (!dataFound && elapsedTime >= maxWaitTime) {
                console.warn(`(${accountFirstName}) Timed out waiting for any rewards data (PC/Mobile or Daily Set).`);
                return;
            }

            const pcStr = pcPoints !== null ? pcPoints : "N/A";
            const mobStr = mobilePoints !== null ? mobilePoints : "N/A";
            const dailySetComparisonStr = dailySetStatus.total > 0 ? `${dailySetStatus.completed}/${dailySetStatus.total}` : "N/A";
            const currentDataStateString = `PC:${pcStr},Mobile:${mobStr},DailySet:${dailySetComparisonStr}`;

            const lastNotificationKey = `lastPointsNotification_${accountFirstName}_PointsNotifier`;
            const lastDataStateString = GM_getValue(lastNotificationKey, "");

            if (currentDataStateString === lastDataStateString && dataFound) {
                console.log(`(${accountFirstName}) Data state is the same as last time and some data was found. Skipping Pushover. State: ${currentDataStateString}`);
                notificationSentThisSession = true;
                return;
            }

            notificationSentThisSession = true;

            let messageParts = [];
            let meaningfulDataPresent = false;

            if (pcPoints !== null) {
                messageParts.push(`PC Search: ${pcPoints} / ${MAX_PC_POINTS} pts`);
                meaningfulDataPresent = true;
            }
            if (mobilePoints !== null) {
                messageParts.push(`Mobile Search: ${mobilePoints} / ${MAX_MOBILE_POINTS} pts`);
                meaningfulDataPresent = true;
            }

            // Add daily set status if tasks were found
            if (dailySetStatus.total > 0) {
                messageParts.push(dailySetStatus.statusString);
                meaningfulDataPresent = true;
            } else if (pcPoints === null && mobilePoints === null) {
                // If NO other data is present, and daily sets were specifically looked for but not found
                // (e.g., on main dashboard page but elements are missing for some reason)
                // you might still want to include this "not found" status.
                // However, if it's just the /pointsbreakdown page, it's expected not to find them.
                // Let's only add "not found" type messages if no other useful data exists.
                if (!meaningfulDataPresent && (dailySetStatus.statusString.includes("not found") || dailySetStatus.statusString.includes("No tasks found"))) {
                   messageParts.push(dailySetStatus.statusString);
                }
            }


            const message = messageParts.join('\n').trim();
            const title = `Bing Points (${accountFirstName})`;

            if (!meaningfulDataPresent && messageParts.length === 0) { // Recheck meaningfulDataPresent OR if message is empty
                console.log(`(${accountFirstName}) No meaningful data to report. Current state: ${currentDataStateString}`);
                if (currentDataStateString !== lastDataStateString) { // Update storage even if not notifying
                    GM_setValue(lastNotificationKey, currentDataStateString);
                }
                return;
            }
             if (message === "" && meaningfulDataPresent) { // Should not happen, but safeguard
                console.log(`(${accountFirstName}) Message is empty but meaningfulDataPresent is true. This is odd. State: ${currentDataStateString}`);
                if (currentDataStateString !== lastDataStateString) {
                    GM_setValue(lastNotificationKey, currentDataStateString);
                }
                return;
            }


            sendPushoverNotification(configuredUserKey, configuredApiToken, message, title);
            GM_setValue(lastNotificationKey, currentDataStateString);

        }, checkInterval);
    }

    function reconfigurePushoverKeys() {
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
    console.log(`Bing Rewards Notifier script started (v${GM_info.script.version}). Current page: ${window.location.href}`);
    if (window.location.href.startsWith("https://rewards.bing.com/")) {
        waitForElementsAndProcess();
    }

})();
