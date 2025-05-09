// ==UserScript==
// @name         Bing Rewards Point Breakdown Data Exporter
// @namespace    http://tampermonkey.net/
// @version      1.1.0 // Simplified for Python backend communication only
// @description  Extracts PC/Mobile points, daily set status, account name from Bing Rewards and sends to a Python backend if coordinated.
// @author       Joao (Modified for Python Coordination)
// @match        https://rewards.bing.com/pointsbreakdown*
// @grant        GM.xmlHttpRequest
// @connect      localhost     // For sending data to Python backend
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict'; // Corrected this line

    // Python backend URL
    const PYTHON_BACKEND_URL = "http://localhost:8765/submit_points"; // Ensure this matches your Python script

    function getAccountFirstName() {
        const nameElement = document.getElementById("redirect_info_link");
        if (nameElement && nameElement.textContent) {
            const fullName = nameElement.textContent.trim();
            if (fullName) {
                return fullName.split(" ")[0]; // Get the first word (e.g., "João" or "Julia")
            }
        }
        console.warn("Point Checker: Could not find account name element or text.");
        return "UnknownAccount"; // Default if name not found or empty
    }

    // --- Point Extraction Logic ---
    function extractPointsData() {
        const pointsCards = document.querySelectorAll('.pointsBreakdownCard');
        let pcPoints = null;
        let mobilePoints = null;

        if (pointsCards.length > 0) {
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
                } else {
                    // Log if elements within a card are not found, can help debug page structure changes
                    // console.debug("Point Checker: Title or points progress element not found in a card.", card);
                }
            });
        } else {
            console.warn("Point Checker: No '.pointsBreakdownCard' elements found on the page.");
        }
        return { pcPoints, mobilePoints };
    }

    // --- Daily Set Completion ---
    function checkDailySetCompletion() {
        const defaultReturn = { total: 0, completed: 0, allAreCompleted: false, allThreeSpecificallyCompleted: false, statusString: "Daily Set: Not processed or found." };
        try {
            const allCardGroups = document.querySelectorAll('div.m-card-group');
            if (allCardGroups.length === 0) {
                return { ...defaultReturn, statusString: "Daily Set: Card group container not found." };
            }

            let targetCardGroup = null;
            for (let i = 0; i < allCardGroups.length; i++) {
                const currentGroup = allCardGroups[i];
                const firstDailySetItemIndicator = currentGroup.querySelector('mee-card mee-rewards-daily-set-item-content[item*="$ctrl.dailySets"]');
                if (firstDailySetItemIndicator) {
                    targetCardGroup = currentGroup;
                    break;
                }
            }

            if (!targetCardGroup) {
                // This might be okay if the daily set section isn't always present or structured this way.
                // console.debug("Point Checker: Target daily set group not found.");
                return { ...defaultReturn, statusString: "Daily Set: Target group not found on page." };
            }

            const dailySetCards = Array.from(targetCardGroup.querySelectorAll('mee-card mee-rewards-daily-set-item-content[item*="$ctrl.dailySets"]'));

            if (dailySetCards.length === 0) {
                // console.debug("Point Checker: No daily set items found within the targeted group.");
                return { ...defaultReturn, statusString: "Daily Set: Items not found in target group." };
            }

            let completedCount = 0;
            dailySetCards.forEach(cardContentElement => { // Iterate over the content elements
                const cardRoot = cardContentElement.closest('mee-card'); // Find the parent mee-card
                if (cardRoot && cardRoot.querySelector('mee-rewards-points span.mee-icon.mee-icon-SkypeCircleCheck')) {
                    completedCount++;
                }
            });

            const totalItems = dailySetCards.length;
            const allThreeSpecificallyCompleted = (totalItems === 3 && completedCount === 3);
            const allFoundTasksAreCompleted = (totalItems > 0 && completedCount === totalItems);

            let statusString;
            if (totalItems === 0) statusString = "Daily Set: No tasks found.";
            else if (allThreeSpecificallyCompleted) statusString = "Daily Set: All 3 completed! ✅";
            else if (allFoundTasksAreCompleted) statusString = `Daily Set: All ${completedCount}/${totalItems} tasks completed! ✅${totalItems !== 3 ? ` (Note: ${totalItems} daily tasks found)` : ""}`;
            else statusString = `Daily Set: ${completedCount}/${totalItems} tasks completed.${totalItems !== 3 ? ` (Note: ${totalItems} daily tasks found)` : ""}`;
            
            return {
                total: totalItems,
                completed: completedCount,
                allAreCompleted: allFoundTasksAreCompleted,
                allThreeSpecificallyCompleted: allThreeSpecificallyCompleted,
                statusString: statusString
            };
        } catch (error) {
            console.error("Point Checker: Error in checkDailySetCompletion:", error);
            return { ...defaultReturn, statusString: "Daily Set: Error during processing." };
        }
    }

    // --- Main Logic ---
    function waitForElementsAndProcess() {
        const accountFirstName = getAccountFirstName();
        console.log(`Point Checker (v${GM_info.script.version}): Account Name Detected: ${accountFirstName}`);

        const urlParams = new URLSearchParams(window.location.search);
        const originChromeProfileFromUrl = urlParams.get('origin_chrome_profile');

        if (!originChromeProfileFromUrl) {
            console.log("Point Checker: No 'origin_chrome_profile' in URL. Script will not send data to backend.");
            return; // Exit if not initiated by Python
        }
        console.log(`Point Checker: Detected origin_chrome_profile: ${originChromeProfileFromUrl} (Python initiated)`);

        const maxWaitTime = 25000; // Max time (ms) to wait for elements before sending whatever is found
        const checkInterval = 1000; // ms
        let elapsedTime = 0;
        let dataSentToPythonThisSession = false;

        const intervalId = setInterval(() => {
            elapsedTime += checkInterval;

            const { pcPoints, mobilePoints } = extractPointsData();
            const dailySetStatus = checkDailySetCompletion();
            
            // Decide if we have enough data or if time is up
            const essentialDataPresent = pcPoints !== null || mobilePoints !== null || (dailySetStatus && dailySetStatus.total > 0);

            if (elapsedTime >= maxWaitTime || (essentialDataPresent && elapsedTime > 3000) ) { // Send after 3s if data is there, or at maxWaitTime
                clearInterval(intervalId);

                if (!dataSentToPythonThisSession) {
                    dataSentToPythonThisSession = true;

                    if (!essentialDataPresent && elapsedTime >= maxWaitTime) {
                        console.warn(`Point Checker (${accountFirstName}): Timed out waiting for rewards data on pointsbreakdown. Sending current (possibly empty) status.`);
                    }

                    const payloadToPython = {
                        account_name: accountFirstName,
                        origin_chrome_profile: originChromeProfileFromUrl,
                        pcPoints: pcPoints,       // Will be null if not found
                        mobilePoints: mobilePoints, // Will be null if not found
                        dailySetStatus: dailySetStatus, // Full object
                        timestamp: new Date().toISOString()
                    };

                    console.log(`Point Checker (${accountFirstName}): Sending data to Python for ${originChromeProfileFromUrl}:`, JSON.stringify(payloadToPython));

                    GM.xmlHttpRequest({
                        method: "POST",
                        url: PYTHON_BACKEND_URL,
                        data: JSON.stringify(payloadToPython),
                        headers: { "Content-Type": "application/json" },
                        onload: function(response) {
                            if (response.status === 200) {
                                console.log(`Point Checker (${accountFirstName}): Successfully sent data to Python for ${originChromeProfileFromUrl}.`);
                            } else {
                                console.error(`Point Checker (${accountFirstName}): Failed to send data to Python for ${originChromeProfileFromUrl}. Status: ${response.status}`, response.responseText);
                            }
                        },
                        onerror: function(response) {
                            console.error(`Point Checker (${accountFirstName}): Network error sending data to Python for ${originChromeProfileFromUrl}:`, response);
                        }
                    });
                }
            } else if (!essentialDataPresent) {
                 console.log(`Point Checker (${accountFirstName}): Waiting for rewards data... (${elapsedTime / 1000}s)`);
            }
        }, checkInterval);
    }

    // --- Start the process ---
    if (window.location.href.startsWith("https://rewards.bing.com/pointsbreakdown")) {
        // A small delay to ensure the page might have started rendering, especially dynamic content
        setTimeout(waitForElementsAndProcess, 500);
    }
})();