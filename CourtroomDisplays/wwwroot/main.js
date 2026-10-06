$(document).ready(async function() {
    const DisplayType = {
        Docket: 0,
        Announcement: 1,
        CourtNotInSession: 2
    };

    // ── CONFIG ────────────────────────────────────────────────────────────────
    // Speed of scroll; higher is faster
    const speed = parseInt(getComputedStyle(document.body).getPropertyValue("--scroll-speed")) || 4;
    // How often to refresh data from the server, in seconds
    const refreshInterval = 600;
    // ─────────────────────────────────────────────────────────────────────────

    // DIV is injected by display.html from the URL ?div= parameter
    const div = (window.COURT_DIV || '').toUpperCase();
    const layout = (window.COURT_LAYOUT || "table").toLowerCase();

    const messageDiv = document.getElementById("message");

    const courtTable = document.getElementById("courtTable");
    let scrollTarget = $("tbody");
    var items, scrollRunning;

    let scheduleMismatch = false;

    //Add css class for large displays
    const params = new URLSearchParams(window.location.search);

    let largeDisplay;

    if (params.has("size")) {
        largeDisplay = params.get("size") === "large";
    } else {
        largeDisplay =
            window.innerWidth >= 3000 ||
            window.innerHeight >= 1700;
    }

    document.body.classList.add(
        largeDisplay ? "display-large" : "display-normal"
    );

    //THEME INITIALIZATION	
    const themes = [{
            name: "Classic",
            className: "theme-default"
        },
        {
            name: "Midnight",
            className: "theme-dark"
        },
        {
            name: "Warm Ledger",
            className: "theme-warm"
        },
        {
            name: "Slate & Teal",
            className: "theme-slate"
        },
        {
            name: "Federal Blue",
            className: "theme-federal"
        },
        {
            name: "Heritage",
            className: "theme-heritage"
        },
        {
            name: "Steel",
            className: "theme-steel"
        },
        {
            name: "Ivory & Navy",
            className: "theme-ivory"
        },
        {
            name: "Civic Teal",
            className: "theme-civic"
        },
        {
            name: "Executive",
            className: "theme-executive"
        },
        {
            name: "Oxford",
            className: "theme-oxford"
        },
        {
            name: "Charcoal & Brass",
            className: "theme-brass"
        }
    ];

    let currentTheme = 0;

    function applyTheme(index) {

        const themeClasses = themes.map(t => t.className);

        document.body.classList.remove(...themeClasses);

        document.body.classList.add(
            themes[index].className
        );

        currentTheme = index;

        localStorage.setItem(
            "courtroomTheme",
            currentTheme
        );
        const button = document.getElementById("themeButton");

        if (button) {
            button.textContent =
                "Theme: " + themes[index].name;
        }
    }

    const savedTheme =
        parseInt(localStorage.getItem("courtroomTheme"), 10);

    if (
        !isNaN(savedTheme) &&
        savedTheme >= 0 &&
        savedTheme < themes.length
    ) {
        currentTheme = savedTheme;
    }

    applyTheme(currentTheme);

    document.getElementById("themeButton").addEventListener(
        "click",
        () => {

            currentTheme =
                (currentTheme + 1) % themes.length;

            applyTheme(currentTheme);
        }
    );

    // Show which courtroom this screen belongs to
    const divLabel = document.getElementById("divLabel");
    if (div === "CRM") {
        divLabel.style.display = "none";
    } else if (div) {
        divLabel.style.display = "";
        divLabel.textContent = "Division " + div;
        document.title = "Division " + div + " – Courtroom Display";
    } else {
        render(DisplayType.CourtNotInSession, null);
        document.getElementById("divLabel").textContent = "No division specified";
    }


    //LOCKED SETTINGS FOR PRODUCTION OR OTHER SPECIFIED IP
    if (window.DISPLAY_LOCKED) {

        // Lock theme to Classic
        const classicIndex =
            themes.findIndex(
                theme => theme.className === "theme-default"
            );

        if (classicIndex >= 0) {
            applyTheme(classicIndex);
        }

        // Lock font to Times New Roman
        document.documentElement.style.fontFamily =
            '"Times New Roman", serif';

        // Hide development controls
        const demoControls =
            document.querySelector(".demoControls");

        if (demoControls) {
            demoControls.style.display = "none";
        }
    }



    setInterval(updateDateTime, 1000);
    updateFontSize();
    startScheduleRecovery();
    updateScheduleStatus();


    if (div) {

        await tryDisplayAnnouncement();

        checkScheduleDate();

        setInterval(
            tryDisplayAnnouncement,
            refreshInterval * 1000
        );

        setInterval(() => {
            location.reload();
        }, 30 * 60 * 1000);
    }

    // ── DISPLAY HELPERS ───────────────────────────────────────────────────────
    function displayMessage(message) {

        courtTable.style.display = "none";
        document.getElementById("crmView").style.display = "none";

        messageDiv.style.display = "block";
        messageDiv.innerText = message;
    }

    function getTodayKey() {

        const now = new Date();

        return (
            now.getFullYear() + "-" +
            String(now.getMonth() + 1).padStart(2, "0") + "-" +
            String(now.getDate()).padStart(2, "0")
        );
    }

    function getVisibleTableHeight() {
        return (
            $(window).height() -
            $("header").height() -
            parseInt($("main").css("margin-top")) -
            $("thead").height()
        );
    }

    // ── DATA FETCHING ─────────────────────────────────────────────────────────
    async function tryDisplayAnnouncement() {

        const response =
            await fetch('./ann.txt?div=' + encodeURIComponent(div));

        if (!response.ok) {
            return tryLoadJSON();
        }

        const annData =
            await response.text();

        if (annData) {
            render(DisplayType.Announcement, annData);
        } else {
            return tryLoadJSON();
        }
    }

    async function checkScheduleDate() {

        try {

            const response =
                await fetch('./schedule-status');

            if (!response.ok) {
                console.warn(
                    'Unable to determine schedule date:',
                    response.status
                );
                return;
            }

            const data =
                await response.json();

            if (!data.scheduleDate) {
                return;
            }

            const now = new Date();

            const today =
                now.getFullYear() + '-' +
                String(now.getMonth() + 1).padStart(2, '0') + '-' +
                String(now.getDate()).padStart(2, '0');

            const message =
                document.getElementById('message');
            const courtTable =
                document.getElementById("courtTable");

            const crmView =
                document.getElementById("crmView");

            if (data.scheduleDate !== today) {
                scheduleMismatch = true;
                console.warn(
                    'SCHEDULE DATE MISMATCH:',
                    data.scheduleDate,
                    'today:',
                    today
                );

                message.innerHTML = `
					<div class="scheduleWarningTitle">
						Schedule Warning
					</div>

					<div class="scheduleWarningText">
						The current docket is not today's schedule.
					</div>

					<div class="scheduleWarningDate">
						Loaded schedule: ${data.scheduleDate}
					</div>

					<div class="scheduleWarningText" style="margin-top:2rem;">
						Today's schedule has not been received.
					</div>
				`;

                message.style.display = "flex";

                courtTable.style.display = "none";
                crmView.style.display = "none";

            } else {
                scheduleMismatch = false;


                // Let the normal rendering code determine
                // which docket view should be visible.
            }

        } catch (err) {

            console.error(
                'Schedule date check failed:',
                err
            );
        }
    }

    async function tryLoadJSON() {
        await fetch('./dm.json?div=' + encodeURIComponent(div))
            .then(response => {
                if (!response.ok) {
                    render(DisplayType.CourtNotInSession, null);
                    return;
                }
                return response.text();
            })
            .then(data => {
                if (data) {
                    render(DisplayType.Docket, JSON.parse(data));
                } else {
                    render(DisplayType.CourtNotInSession, null);
                }
            })
            .catch(err => {
                console.error("[dm.json] ACTUAL ERROR:", err);
                render(DisplayType.CourtNotInSession, null);
            });
    }

    // ── SCROLLING ─────────────────────────────────────────────────────────────
    function startScroll() {
        scroll();
    }

    function startCRMScroll(target) {

        if (needsScroll(target)) {
            autoScrollCRM(target);
        }
    }

    function scroll() {

        scrollRunning = true;

        var elementHeight = scrollTarget.height();

        var visibleHeight = getVisibleTableHeight();

        if (elementHeight > visibleHeight) {
            autoscroll();
        }
    }

    function autoscroll() {
        let lastTime = performance.now();

        function step(currentTime) {
            if (!scrollRunning) {
                return;
            }

            const elapsed = currentTime - lastTime;
            lastTime = currentTime;

            const pixelsPerSecond = speed * 10;
            const currentPosition = parseFloat(scrollTarget.css("top")) || 0;
            const newPosition =
                currentPosition - (pixelsPerSecond * elapsed / 1000);

            scrollTarget.css("top", newPosition + "px");

            const contentHeight = scrollTarget.height();

            if (scrollTarget.attr("id") === "crmColumns") {
                if (newPosition * -1 > contentHeight) {
                    scrollTarget.css("top", "0px");
                }
            } else {
                if (newPosition * -1 > contentHeight / 2.3) {
                    cloneFirstToLast();
                    cloneFirstToLast();
                }
            }

            requestAnimationFrame(step);
        }

        requestAnimationFrame(step);
    }

    function autoScrollCRM(target) {

        const content = target.children(":first");

        if (!content.length) {
            return;
        }

        if (!target.data("duplicated")) {
            target.append(content.clone());
            target.data("duplicated", true);
        }

        const singleHeight =
            content[0].getBoundingClientRect().height;

        const pixelsPerSecond = 25;
        const duration = singleHeight / pixelsPerSecond;

        target[0].style.setProperty(
            "--crm-scroll-distance",
            `${singleHeight}px`
        );

        target[0].style.setProperty(
            "--crm-scroll-duration",
            `${duration}s`
        );

        target.removeClass("scrolling");

        void target[0].offsetWidth;

        target.addClass("scrolling");
    }

    function cloneFirstToLast() {
        var firstChild = scrollTarget.children(":first");
        scrollTarget.append(firstChild[0]);
        var currentPosition = parseInt(scrollTarget.css("top"));
        scrollTarget.css("top", (currentPosition + firstChild[0].clientHeight) + 'px');
    }


    // ── DATE / TIME ───────────────────────────────────────────────────────────
    function updateFontSize() {
        parseFloat(getComputedStyle(document.documentElement).fontSize);
    }
    async function updateScheduleStatus() {

        try {

            const response =
                await fetch(
                    "./schedule-status?check=" +
                    Date.now()
                );

            if (!response.ok) {
                console.warn(
                    "[schedule] Schedule status request failed:",
                    response.status
                );
                return;
            }

            const data =
                await response.json();
            window.scheduleModified = data.modified;

            const todayKey =
                getTodayKey();

            const status =
                document.getElementById("scheduleStatus");

            // ========================================
            // CURRENT
            // ========================================

            if (data.scheduleDate === todayKey) {

                if (data.modified) {

                    const modified =
                        new Date(data.modified);

                    status.textContent =
                        "Schedule is current as of " +
                        modified.toLocaleString();
                }

                document.body.classList.remove(
                    "schedule-mismatch"
                );

                return;
            }

            // ========================================
            // MISMATCH
            // ========================================

            status.textContent =
                "Schedule does not match today";

            document.body.classList.add(
                "schedule-mismatch"
            );

            if (window.startScheduleRecovery) {
                window.startScheduleRecovery();
            }

        } catch (err) {

            console.error(
                "Unable to get schedule timestamp",
                err
            );
        }
    }

    function startScheduleRecovery() {
        let recoveryTimer = null;

        async function checkScheduleRecovery() {

            try {

                const response = await fetch(
                    "./schedule-status?check=" + Date.now()
                );

                if (!response.ok) {
                    console.warn(
                        "[schedule] Recovery request failed:",
                        response.status
                    );
                    return;
                }

                const data = await response.json();

                const todayKey = getTodayKey();

                if (data.scheduleDate === todayKey) {

                    if (recoveryTimer) {
                        clearInterval(recoveryTimer);
                        recoveryTimer = null;
                    }

                    location.reload();
                }

            } catch (err) {

                console.error(
                    "[schedule] Recovery check failed:",
                    err
                );
            }
        }


        window.startScheduleRecovery = function() {

            // Don't start another timer if one is already running
            if (recoveryTimer) {
                return;
            }

            // Check immediately
            checkScheduleRecovery();

            // Then check every 2 minutes
            recoveryTimer = setInterval(
                checkScheduleRecovery,
                2 * 60 * 1000
            );
        };
    }

    function updateDateTime() {
        const now = new Date();
        const options = {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        };
        document.getElementById("date").textContent = now.toLocaleDateString(undefined, options);
        document.getElementById("time").textContent = now.toLocaleTimeString();
    }

    function groupByTime(rows) {

        const groups = {};

        rows.forEach(r => {

            if (!groups[r.TIME]) {
                groups[r.TIME] = [];
            }

            groups[r.TIME].push(r);

        });

        return groups;

    }

    // ── RENDER ────────────────────────────────────────────────────────────────
    function hasMultipleDivisions(items) {
        const divisions = new Set(
            items.map(x => (x.DIV || '').trim())
            .filter(x => x !== '')
        );

        return divisions.size > 1;
    }

    function render(type, data) {
        if (scheduleMismatch) {
            return;
        }
        switch (type) {
            case DisplayType.Docket:

                items = data;



                if (layout === "split" && div === "CRM") {
                    renderSplit(items);
                } else {
                    renderStandard(items);
                }

                break;

            case DisplayType.Announcement:
                scrollRunning = false;
                displayMessage(data);
                break;

            default:
                scrollRunning = false;
                displayMessage("Court Not In Session");
                break;
        }
    }

    function renderStandard(items) {
        const showDivision = hasMultipleDivisions(items);
        scrollRunning = false;
        scrollTarget.css("top", "0px");
        document.getElementById("divisionHeader").style.display = showDivision ? "" : "none";
        const tbody = courtTable.querySelector("tbody");
        tbody.innerHTML = "";

        if (items.length !== 0) {

            populateTable(items, tbody);

            var elementHeight = scrollTarget.height();
            var visibleHeight = getVisibleTableHeight();
            var lowSide = visibleHeight * 0.9;
            var highSide = visibleHeight * 3;

            if (elementHeight > lowSide && elementHeight < highSide) {
                populateTable(items, tbody);
            }
        }

        document.getElementById("crmView").style.display = "none";
        courtTable.style.display = "table";

        scrollTarget = $("tbody");

        if (!scrollRunning) {
            startScroll();
        }


    }

    function renderSplit(items) {
        if (scheduleMismatch) {
            return;
        }

        try {

            scrollRunning = false;

            courtTable.style.display = "none";

            const crmView = document.getElementById("crmView");
            const div6Container = document.getElementById("crmScroll6");
            const div27Container = document.getElementById("crmScroll27");

            const div6 = items.filter(x => x.DIV === "6");
            const div27 = items.filter(x => x.DIV === "27");



            // Nothing scheduled for either division
            if (div6.length === 0 && div27.length === 0) {

                crmView.style.display = "none";

                const noCasesMessage = document.getElementById("message");

                const reportTime = window.scheduleModified ?
                    new Date(window.scheduleModified).toLocaleString() :
                    "the latest report";

                noCasesMessage.innerHTML = `
					<div class="noCasesMessage">
						<div>No cases scheduled as of ${reportTime}.</div>
						<div>Cases are sometimes added the day of.</div>
						<div>Please speak with the division if you have questions.</div>
					</div>
				`;

                noCasesMessage.style.display = "block";

                return;
            }

            // Cases exist - hide the message and show CRM
            messageDiv.style.display = "none";
            messageDiv.innerHTML = "";

            crmView.style.display = "flex";

            div6Container.innerHTML = "";
            div27Container.innerHTML = "";

            div6Container.appendChild(
                buildDivisionContent(groupByTime(div6))
            );

            div27Container.appendChild(
                buildDivisionContent(groupByTime(div27))
            );

            const left = $("#crmScroll6");
            const right = $("#crmScroll27");

            left.css("top", "0px");
            right.css("top", "0px");

            startCRMScroll(left);
            startCRMScroll(right);

        } catch (e) {
            console.error("renderSplit failed:", e);
        }
    }

    function startCRMScroll(target) {

        const shouldScroll = needsScroll(target);

        if (target.data("scrolling")) {
            return;
        }

        if (shouldScroll) {
            target.data("scrolling", true);
            autoScrollCRM(target);
        }
    }

    function needsScroll(target) {
        const element = target[0];

        if (!element) {
            return false;
        }

        const viewport =
            document.querySelector("#crmScrollArea").clientHeight;

        const contentHeight =
            element.scrollHeight;

        return contentHeight > viewport;
    }

    function buildDivisionContent(groups) {

        const container = document.createElement("div");

        Object.keys(groups).forEach(time => {

            const t = document.createElement("div");
            t.className = "crmTime";
            t.textContent = time;

            container.appendChild(t);

            groups[time].forEach(item => {

                const c = document.createElement("div");
                c.className = "crmCase";

                c.textContent =
                    item["CASE ID"] +
                    (item["STYLE"] ? " - " + item["STYLE"] : "");

                container.appendChild(c);

            });

        });

        return container;
    }

    function populateTable(items, tbody) {

        const showDivision = hasMultipleDivisions(items);

        for (let i = 0; i < items.length; i++) {

            const row = document.createElement("tr");
            row.classList.add("box");

            if (showDivision) {
                const divCell = document.createElement("td");
                divCell.textContent = items[i]["DISPLAY DIV"] || items[i]["DIV"];
                divCell.className = items[i]["DIV CLASS"] || "";
                row.appendChild(divCell);
            }

            const caseCell = document.createElement("td");
            caseCell.textContent = items[i]["CASE ID"];
            row.appendChild(caseCell);


            const styleCell = document.createElement("td");
            styleCell.textContent = items[i]["STYLE"];
            row.appendChild(styleCell);


            const timeCell = document.createElement("td");
            timeCell.textContent = items[i]["TIME"];
            row.appendChild(timeCell);


            tbody.appendChild(row);
        }
    }

    /*Font Trial*/

    const googleFonts = [
        "Inter",
        "Source Sans 3",
        "Public Sans",
        "IBM Plex Sans",
        "Lato"
    ];

    const windowsFonts = [
        "Aptos",
        "Segoe UI",
        "Franklin Gothic Book",
        "Trebuchet MS",
        "Times New Roman"
    ];

    const fonts = [
        ...windowsFonts.map(font => ({
            name: font,
            type: "windows"
        })),

        ...googleFonts.map(font => ({
            name: font,
            type: "google"
        }))
    ];

    let fontIndex = 0;

    const fontButton =
        document.getElementById("fontToggle");

    fontButton.onclick = () => {

        const font = fonts[fontIndex];

        document.documentElement.style.fontFamily =
            `"${font.name}", sans-serif`;

        fontButton.textContent =
            "Font: " + font.name;

        fontIndex =
            (fontIndex + 1) % fonts.length;
    };

});