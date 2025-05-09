// ==UserScript==
// @name         Bing Rewards Point Breakdown Notifier (Python Coordinated)
// @namespace    http://tampermonkey.net/
// @version      0.9.0 // Incremented version for Python coordination
// @description  Extracts PC/Mobile points, daily set status, account name, from Bing Rewards. Sends to Python backend if coordinated, and optionally sends Pushover.
// @author       Joao (Modified for Python Coordination)
// @match        https://rewards.bing.com/pointsbreakdown*
// @grant        GM.xmlHttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @connect      api.pushover.net
// @connect      localhost
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    // Constants for storage keys (for Pushover)
    const PUSHOVER_USER_KEY_STORAGE_ID = "pushoverUserKey_PointsNotifier";
    const PUSHOVER_API_TOKEN_STORAGE_ID = "pushoverApiToken_PointsNotifier";

    // Python backend URL
    const PYTHON_BACKEND_URL = "http://localhost:8765/submit_points"; // Ensure this matches your Python script

    let configuredUserKey = null;
    let configuredApiToken = null;

    // Configuration Function (for Pushover)
    function getConfiguredKey(storageId, promptMessage, isSensitive = false) {
        let keyValue = GM_getValue(storageId, null);
        if (!keyValue) {
            keyValue = prompt(promptMessage);
            if (keyValue && keyValue.trim() !== "") {
                GM_setValue(storageId, keyValue.trim());
                alert( (isSensitive ? "Token" : "Key") + " saved. You may need to reload for it to take effect if this is the first time.");
            } else {
                alert("Configuration for Pushover '" + (isSensitive ? "Token" : "Key") + "' is required for Pushover notifications.");
                return null;
            }
        }
        return keyValue;
    }

    function initializePushoverKeys() {
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
                return fullName.split(" ")[0]; // Get the first word (e.g., "João" or "Julia")
            }
        }
        return "Account"; // Default if name not found or empty
    }

    function sendPushoverNotification(userKey, apiToken, message, title = "Bing Rewards Update") {
        if (!userKey || !apiToken) {
            console.error("Pushover User Key or API Token is missing. Cannot send Pushover notification. Please configure them via the script menu.");
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
        let pcPoints = null; // Initialize to null to indicate not found
        let mobilePoints = null; // Initialize to null

        if (pointsCards.length > 0) {
            pointsCards.forEach(card => {
                const titleElement = card.querySelector('.pointsDetail .title-detail p a');
                const pointsProgressElement = card.querySelector('.pointsDetail .title-detail p.pointsDetail b');

                if (titleElement && pointsProgressElement) {
                    const titleText = titleElement.textContent.trim().toLowerCase();
                    const pointsText = pointsProgressElement.textContent.trim(); // e.g., "90 / 90 pts"

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
        const defaultReturn = { total: 0, completed: 0, allAreCompleted: false, allThreeSpecificallyCompleted: false, statusString: "Daily Set: Not processed or found." };
        try {
            const allCardGroups = document.querySelectorAll('div.m-card-group');
            if (allCardGroups.length === 0) {
                return { ...defaultReturn, statusString: "Daily Set: Card group not found." };
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
                return { ...defaultReturn, statusString: "Daily Set: Target group not found." };
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
                return { ...defaultReturn, statusString: "Daily Set: Items not found in target group." };
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
            if (totalItems === 0) {
                statusString = "Daily Set: No tasks found.";
            } else if (allThreeSpecificallyCompleted) {
                statusString = "Daily Set: All 3 completed! ✅";
            } else if (allFoundTasksAreCompleted) {
                statusString = `Daily Set: All ${completedCount}/${totalItems} tasks completed! ✅`;
                if (totalItems !== 3) {
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
        } catch (error) {
            console.error("Error in checkDailySetCompletion:", error);
            return { ...defaultReturn, statusString: "Daily Set: Error during processing." };
        }
    }


    // --- Main Logic: Wait for elements and process ---
    function waitForElementsAndProcess() {
        // Initialize Pushover keys (will prompt if not set)
        // This doesn't block sending to Python backend if Pushover isn't configured.
        const pushoverInitialized = initializePushoverKeys();
        if (!pushoverInitialized) {
            console.warn("Pushover keys not (fully) configured. Pushover notifications will not be sent until keys are set via the menu command.");
        }

        const accountFirstName = getAccountFirstName(); // e.g., "João" or "Julia"
        console.log("Bing Rewards Notifier: Account Name Detected:", accountFirstName);

        // Get origin_chrome_profile from URL (passed by Python)
        const urlParams = new URLSearchParams(window.location.search);
        const originChromeProfileFromUrl = urlParams.get('origin_chrome_profile'); // e.g., "Profile 1" or null

        if (originChromeProfileFromUrl) {
            console.log(`Bing Rewards Notifier: Detected origin_chrome_profile: ${originChromeProfileFromUrl} (Python initiated)`);
        } else {
            console.log("Bing Rewards Notifier: No origin_chrome_profile detected in URL (manual visit or different script).");
        }

        const MAX_PC_POINTS_DISPLAY = 90; // For constructing Pushover message
        const MAX_MOBILE_POINTS_DISPLAY = 60; // For constructing Pushover message

        const maxWaitTime = 30000; // 30 seconds
        const checkInterval = 1000; // Check every 1 second
        let elapsedTime = 0;
        let dataSentToPythonThisSession = false; // Prevent multiple sends to Python per page load
        let pushoverSentThisSession = false; // Prevent multiple Pushover sends per page load

        const intervalId = setInterval(() => {
            elapsedTime += checkInterval;

            const { pcPoints, mobilePoints } = extractPointsData();
            const dailySetStatus = checkDailySetCompletion();

            // Check if any meaningful data was extracted
            const anyDataExtracted = pcPoints !== null || mobilePoints !== null || (dailySetStatus && dailySetStatus.total > 0);

            if (!anyDataExtracted && elapsedTime < maxWaitTime) {
                console.log(`(${accountFirstName}) Waiting for rewards data... (${elapsedTime / 1000}s)`);
                return; // Continue waiting if no data yet and not timed out
            }

            clearInterval(intervalId); // Stop interval, we'll make a decision now

            if (!anyDataExtracted && elapsedTime >= maxWaitTime) {
                console.warn(`(${accountFirstName}) Timed out waiting for any rewards data (PC/Mobile or Daily Set).`);
                 // Still attempt to send to Python if originChromeProfileFromUrl is present,
                 // so Python knows the check was attempted but yielded no data.
            }

            // --- Send data to Python backend IF this page load was initiated by Python ---
            if (originChromeProfileFromUrl && !dataSentToPythonThisSession) {
                const payloadToPython = {
                    account_name: accountFirstName,
                    origin_chrome_profile: originChromeProfileFromUrl,
                    pcPoints: pcPoints, // Will be null if not found
                    mobilePoints: mobilePoints, // Will be null if not found
                    dailySetStatus: dailySetStatus, // The full object from checkDailySetCompletion
                    timestamp: new Date().toISOString()
                };

                console.log(`(${accountFirstName}) Attempting to send data to Python backend for origin profile ${originChromeProfileFromUrl}:`, payloadToPython);
                dataSentToPythonThisSession = true; // Attempt send only once

                GM.xmlHttpRequest({
                    method: "POST",
                    url: PYTHON_BACKEND_URL,
                    data: JSON.stringify(payloadToPython),
                    headers: { "Content-Type": "application/json" },
                    onload: function(response) {
                        if (response.status === 200) {
                            console.log(`(${accountFirstName}) Successfully sent points data to Python for ${originChromeProfileFromUrl}. Response:`, response.responseText);
                        } else {
                            console.error(`(${accountFirstName}) Failed to send points data to Python for ${originChromeProfileFromUrl}. Status: ${response.status}`, response.responseText);
                        }
                    },
                    onerror: function(response) {
                        console.error(`(${accountFirstName}) Network error sending points data to Python for ${originChromeProfileFromUrl}:`, response);
                    }
                });
            } else if (originChromeProfileFromUrl && dataSentToPythonThisSession) {
                 console.log(`(${accountFirstName}) Data already attempted to be sent to Python this session for ${originChromeProfileFromUrl}.`);
            } else {
                 console.log(`(${accountFirstName}) Not sending to Python: origin_chrome_profile not set. This was likely a manual visit to pointsbreakdown.`);
            }


            // --- Pushover Notification Logic (Independent of Python send) ---
            // This logic remains to allow Pushover for manual visits or if you want separate notifications.
            if (pushoverInitialized && !pushoverSentThisSession) {
                const pcStrForPushover = pcPoints !== null ? pcPoints : "N/A";
                const mobStrForPushover = mobilePoints !== null ? mobilePoints : "N/A";
                const dailySetComparisonStrForPushover = (dailySetStatus && dailySetStatus.total > 0) ? `${dailySetStatus.completed}/${dailySetStatus.total}` : "N/A";

                // State string for comparing with last Pushover notification to avoid spam
                const currentDataStateStringForPushover = `PC:${pcStrForPushover},Mobile:${mobStrForPushover},DailySet:${dailySetComparisonStrForPushover}`;
                const lastPushoverNotificationKey = `lastPushoverNotification_${accountFirstName}_PointsNotifier`;
                const lastPushoverDataStateString = GM_getValue(lastPushoverNotificationKey, "");

                if (currentDataStateStringForPushover === lastPushoverDataStateString && anyDataExtracted) {
                    console.log(`(${accountFirstName}) Pushover: Data state is the same as last time. Skipping Pushover. State: ${currentDataStateStringForPushover}`);
                    pushoverSentThisSession = true; // Mark as "processed" for Pushover
                    return; // Exit Pushover block
                }

                pushoverSentThisSession = true; // Mark as "processed" for Pushover

                let pushoverMessageParts = [];
                let meaningfulDataForPushover = false;

                if (pcPoints !== null) {
                    pushoverMessageParts.push(`PC Search: ${pcPoints} / ${MAX_PC_POINTS_DISPLAY} pts`);
                    meaningfulDataForPushover = true;
                }
                if (mobilePoints !== null) {
                    pushoverMessageParts.push(`Mobile Search: ${mobilePoints} / ${MAX_MOBILE_POINTS_DISPLAY} pts`);
                    meaningfulDataForPushover = true;
                }
                if (dailySetStatus && dailySetStatus.statusString && dailySetStatus.total > 0) { // Only include if tasks were found
                    pushoverMessageParts.push(dailySetStatus.statusString);
                    meaningfulDataForPushover = true;
                }

                const pushoverMessage = pushoverMessageParts.join('\n').trim();
                const pushoverTitle = `Bing Points (${accountFirstName})`;

                if (meaningfulDataForPushover && pushoverMessage !== "") {
                    sendPushoverNotification(configuredUserKey, configuredApiToken, pushoverMessage, pushoverTitle);
                    GM_setValue(lastPushoverNotificationKey, currentDataStateStringForPushover); // Update last sent state for Pushover
                } else {
                    console.log(`(${accountFirstName}) Pushover: No meaningful data to report for Pushover. Current state: ${currentDataStateStringForPushover}`);
                    if (currentDataStateStringForPushover !== lastPushoverDataStateString) { // Still update storage if state changed but not enough for notification
                        GM_setValue(lastPushoverNotificationKey, currentDataStateStringForPushover);
                    }
                }
            } else if (pushoverInitialized && pushoverSentThisSession) {
                 console.log(`(${accountFirstName}) Pushover notification already processed this session.`);
            }


        }, checkInterval);
    }

    function reconfigurePushoverKeys() {
        alert("You will be prompted to re-enter your Pushover User Key and API Token.");
        GM_setValue(PUSHOVER_USER_KEY_STORAGE_ID, null);
        GM_setValue(PUSHOVER_API_TOKEN_STORAGE_ID, null);

        if (initializePushoverKeys()) {
            alert("Pushover keys reconfigured successfully. You might need to reload the page.");
        } else {
            alert("Pushover key reconfiguration was cancelled or failed.");
        }
    }

    if (typeof GM_registerMenuCommand === "function") {
        GM_registerMenuCommand("Configure Pushover Keys (Points Notifier)", reconfigurePushoverKeys, "c");
    }

    // --- Start the process ---
    console.log(`Bing Rewards Notifier script (v${GM_info.script.version}) started. Current page: ${window.location.href}`);
    if (window.location.href.startsWith("https://rewards.bing.com/pointsbreakdown")) { // Ensure it only runs on the breakdown page
        waitForElementsAndProcess();
    }

})();