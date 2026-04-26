const API = location.origin;

let token = localStorage.getItem("hersafe_token");
let currentUser = JSON.parse(localStorage.getItem("hersafe_user") || "null");
let mode = "login";

let map, userMarker, destMarker, routeLine;
let currentPos = null;
let activeTripId = null;
let watchId = null;
let ws = null;

let geocodeCache = {};
let destinationTypingTimer = null;

let audioCtx, oscillator;
let notificationsEnabled = localStorage.getItem("notificationsEnabled") === "true";

const $ = (id) => document.getElementById(id);

const authHeaders = () => ({
    "Content-Type": "application/json",
    "Authorization": "Bearer " + token
});

function toast(message) {
    const box = $("aiOutput");

    if (box) {
        box.innerHTML =
            `<div class="card"><strong>${message}</strong></div>` + box.innerHTML;
    }

    if (
        notificationsEnabled &&
        "Notification" in window &&
        Notification.permission === "granted"
    ) {
        new Notification("HerSafe+", { body: message });
    }
}

async function api(path, options = {}) {
    const res = await fetch(API + path, options);
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
        throw new Error(data.detail || "Request failed");
    }

    return data;
}

function showPage(id) {
    document.querySelectorAll(".page").forEach((p) => p.classList.add("hidden"));

    const page = $(id);
    if (page) page.classList.remove("hidden");

    document.querySelectorAll("nav button[data-page]").forEach((b) => {
        b.classList.toggle("active", b.dataset.page === id);
    });

    if (id === "trip") {
        setTimeout(initMap, 150);
    }
}

function setLoggedIn(logged) {
    $("authPage").classList.toggle("hidden", logged);
    $("nav").classList.toggle("hidden", !logged);

    if (logged) {
        showPage("dashboard");
        loadAll();
    } else {
        showPage("authPage");
    }
}

/* ---------------- AUTH ---------------- */

$("loginTab").onclick = () => {
    mode = "login";
    $("loginTab").classList.add("active");
    $("signupTab").classList.remove("active");
    document.querySelectorAll(".signup-only").forEach((x) => x.classList.add("hidden"));
};

$("signupTab").onclick = () => {
    mode = "signup";
    $("signupTab").classList.add("active");
    $("loginTab").classList.remove("active");
    document.querySelectorAll(".signup-only").forEach((x) => x.classList.remove("hidden"));
};

$("authForm").onsubmit = async (e) => {
    e.preventDefault();
    $("authMsg").textContent = "";

    try {
        const body =
            mode === "signup"
                ? {
                    name: $("name").value,
                    email: $("email").value,
                    phone: $("phone").value,
                    password: $("password").value
                }
                : {
                    email: $("email").value,
                    password: $("password").value
                };

        const data = await api(
            mode === "signup" ? "/api/auth/register" : "/api/auth/login",
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body)
            }
        );

        token = data.access_token;
        currentUser = data.user;

        localStorage.setItem("hersafe_token", token);
        localStorage.setItem("hersafe_user", JSON.stringify(currentUser));

        setLoggedIn(true);
    } catch (err) {
        $("authMsg").textContent = err.message;
    }
};

$("logoutBtn").onclick = () => {
    localStorage.removeItem("hersafe_token");
    localStorage.removeItem("hersafe_user");
    token = null;
    currentUser = null;
    location.reload();
};

document.querySelectorAll("nav button[data-page]").forEach((btn) => {
    btn.onclick = () => showPage(btn.dataset.page);
});

/* ---------------- LOCATION + MAP ---------------- */

function getCurrentLocation() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            reject(new Error("Geolocation is not supported."));
            return;
        }

        navigator.geolocation.getCurrentPosition(
            (pos) => {
                currentPos = {
                    lat: pos.coords.latitude,
                    lng: pos.coords.longitude,
                    accuracy: pos.coords.accuracy
                };
                resolve(currentPos);
            },
            reject,
            { enableHighAccuracy: true, timeout: 10000 }
        );
    });
}
async function getPlaceName(lat, lng) {
    try {
        const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`;
        const res = await fetch(url);
        const data = await res.json();

        return data.display_name || "Unknown location";
    } catch (err) {
        console.error("Reverse geocode failed:", err);
        return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    }
}
function initMap() {
    if (map) {
        map.invalidateSize();
        return;
    }

    map = L.map("map").setView([18.5204, 73.8567], 13);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap"
    }).addTo(map);

    map.on("click", async (e) => {
        $("destLat").value = e.latlng.lat.toFixed(6);
        $("destLng").value = e.latlng.lng.toFixed(6);

        const place = await getPlaceName(e.latlng.lat, e.latlng.lng);
        $("destName").value = place;

        const dest = { lat: e.latlng.lat, lng: e.latlng.lng };

        if (currentPos) {
            drawRoute(currentPos, dest);
        }

        toast("Destination selected from map.");
    });

    getCurrentLocation()
        .then((pos) => {
            getPlaceName(pos.lat, pos.lng).then((place) => {
                $("sourceName").value = `Live Location: ${place}`;
            });

            map.setView([pos.lat, pos.lng], 15);
            userMarker = L.marker([pos.lat, pos.lng])
                .addTo(map)
                .bindPopup("You are here");
        })
        .catch(() => {
            $("sourceName").value = "Location permission needed";
        });
}

async function drawRoute(start, dest) {
    initMap();

    if (userMarker) {
        userMarker.setLatLng([start.lat, start.lng]);
    } else {
        userMarker = L.marker([start.lat, start.lng]).addTo(map).bindPopup("You are here");
    }

    if (destMarker) {
        destMarker.setLatLng([dest.lat, dest.lng]).bindPopup(dest.name || "Destination");
    } else {
        destMarker = L.marker([dest.lat, dest.lng]).addTo(map).bindPopup(dest.name || "Destination");
    }

    try {
        const url = `https://router.project-osrm.org/route/v1/driving/${start.lng},${start.lat};${dest.lng},${dest.lat}?overview=full&geometries=geojson`;
        const res = await fetch(url);
        const data = await res.json();

        if (!data.routes || !data.routes.length) throw new Error("No route found");

        const coords = data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);

        if (routeLine) map.removeLayer(routeLine);

        routeLine = L.polyline(coords, { weight: 5 }).addTo(map);
        map.fitBounds(routeLine.getBounds(), { padding: [30, 30] });
    } catch (err) {
        if (routeLine) map.removeLayer(routeLine);

        routeLine = L.polyline(
            [[start.lat, start.lng], [dest.lat, dest.lng]],
            { weight: 5 }
        ).addTo(map);

        map.fitBounds(routeLine.getBounds(), { padding: [30, 30] });
    }
}

async function geocodePlace(place) {
    if (!place || !place.trim()) return null;

    const key = place.trim().toLowerCase();
    if (geocodeCache[key]) return geocodeCache[key];

    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(place)}&limit=1`;

    const res = await fetch(url);
    const data = await res.json();

    if (!data.length) return null;

    const result = {
        lat: Number(data[0].lat),
        lng: Number(data[0].lon),
        name: data[0].display_name
    };

    geocodeCache[key] = result;
    return result;
}

async function getDestination(pos) {
    const place = $("destName").value.trim();

    // If user typed destination name, always use it first
    if (place && place !== "Selected on map") {
        const found = await geocodePlace(place);

        if (found) {
            $("destLat").value = found.lat.toFixed(6);
            $("destLng").value = found.lng.toFixed(6);
            $("destName").value = place;

            return {
                lat: found.lat,
                lng: found.lng,
                name: place
            };
        }
    }

    const lat = Number($("destLat").value);
    const lng = Number($("destLng").value);

    if (!Number.isNaN(lat) && !Number.isNaN(lng) && lat && lng) {
        const name = await getPlaceName(lat, lng);
        $("destName").value = name;

        return { lat, lng, name };
    }

    toast("Please enter destination name or click on map.");
    return null;
}

if ($("destName")) {
    $("destName").addEventListener("input", () => {
        $("destLat").value = "";
        $("destLng").value = "";

        clearTimeout(destinationTypingTimer);

        destinationTypingTimer = setTimeout(async () => {
            const place = $("destName").value.trim();
            if (!place || place.length < 3) return;

            const pos = currentPos || await getCurrentLocation().catch(() => null);
            if (!pos) return;

            const found = await geocodePlace(place);

            if (found) {
                $("destLat").value = found.lat.toFixed(6);
                $("destLng").value = found.lng.toFixed(6);

                drawRoute(pos, found);
                toast("Destination updated on map.");
            }
        }, 700);
    });
}

/* ---------------- LOAD ---------------- */

async function loadAll() {
    updateNotificationUI();
    loadContacts();
    loadTasks();
    loadSettings();
}

/* ---------------- NOTIFICATIONS ---------------- */

function updateNotificationUI() {
    const state = $("notificationState");
    const btn = $("notifyPermission");

    if (!state || !btn) return;

    const permission =
        "Notification" in window ? Notification.permission : "unsupported";

    if (notificationsEnabled && permission === "granted") {
        state.textContent = "On";
        state.className = "badge success";
        btn.textContent = "Disable Notifications";
        $("safetyStatus").textContent = "Ready";
    } else if (permission === "denied") {
        notificationsEnabled = false;
        localStorage.setItem("notificationsEnabled", "false");
        state.textContent = "Blocked";
        state.className = "badge danger";
        btn.textContent = "Blocked in Browser";
        $("safetyStatus").textContent = "Notifications blocked";
    } else {
        notificationsEnabled = false;
        localStorage.setItem("notificationsEnabled", "false");
        state.textContent = "Off";
        state.className = "badge";
        btn.textContent = "Enable Notifications";
        $("safetyStatus").textContent = "Ready";
    }
}

async function toggleNotifications() {
    if (!("Notification" in window)) {
        alert("Browser notifications are not supported.");
        return;
    }

    if (!notificationsEnabled) {
        const permission = await Notification.requestPermission();

        if (permission === "granted") {
            notificationsEnabled = true;
            localStorage.setItem("notificationsEnabled", "true");
            new Notification("HerSafe+ notifications enabled");
            toast("Browser notifications enabled.");
        } else {
            notificationsEnabled = false;
            localStorage.setItem("notificationsEnabled", "false");
            alert("Notification permission was not granted.");
        }
    } else {
        notificationsEnabled = false;
        localStorage.setItem("notificationsEnabled", "false");
        toast("Browser notifications disabled inside HerSafe+.");
    }

    updateNotificationUI();
}

$("notifyPermission").onclick = toggleNotifications;

if ($("enableSafetyMode")) {
    $("enableSafetyMode").onclick = () => {
        showPage("trip");
        toast("Safety Mode activated. Start your trip tracking.");
    };
}

/* ---------------- CONTACTS ---------------- */

$("contactForm").onsubmit = async (e) => {
    e.preventDefault();

    const body = {
        name: $("contactName").value,
        phone: $("contactPhone").value,
        email: $("contactEmail").value || null,
        relationship: $("relationship").value,
        is_primary: $("isPrimary").checked
    };

    await api("/api/contacts", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(body)
    });

    e.target.reset();
    loadContacts();
    toast("Trusted contact saved.");
};

async function loadContacts() {
    const contacts = await api("/api/contacts", { headers: authHeaders() }).catch(() => []);

    $("contactsList").innerHTML = contacts.length
        ? contacts
            .map(
                (c) => `
          <div class="contact-row">
            <div>
              <b>${c.name}</b>
              ${c.is_primary ? '<span class="pill">Primary</span>' : ""}
              <br>
              <span class="muted">${c.phone} ${c.relationship || ""}</span>
              ${c.email ? `<br><span class="muted">${c.email}</span>` : ""}
            </div>
            <button onclick="deleteContact(${c.id})" class="ghost">Delete</button>
          </div>
        `
            )
            .join("")
        : '<p class="muted">No trusted contacts yet. Add at least one before SOS demo.</p>';
}

window.deleteContact = async (id) => {
    if (!confirm("Delete this trusted contact?")) return;

    await api("/api/contacts/" + id, {
        method: "DELETE",
        headers: authHeaders()
    });

    loadContacts();
    toast("Trusted contact deleted.");
};

/* ---------------- TASKS ---------------- */

$("addTask").onclick = async () => {
    const title = $("taskTitle").value.trim();

    if (!title) {
        alert("Please enter a task.");
        return;
    }

    const priority = detectTaskPriority(title);

    await api("/api/tasks", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
            title,
            priority
        })
    });

    $("taskTitle").value = "";

    loadTasks();
    toast(`Task added with ${formatPriority(priority)} priority.`);
};


async function loadTasks() {
    const data = await api("/api/tasks", { headers: authHeaders() }).catch(() => ({
        tasks: [],
        suggestions: []
    }));

    const tasksHtml = data.tasks.length
        ? data.tasks
            .slice(0, 8)
            .map(
                (t) => `
        <div class="task-row">
          <div>
            <b class="${t.status === "done" ? "done-text" : ""}">${t.title}</b>
            <br>
            <span class="muted">Progress: ${formatStatus(t.status || "pending")}</span>
          </div>

          <span class="pill ${priorityClass(t.priority)}">
            ${formatPriority(t.priority)}
          </span>

          <div class="task-actions">
            <button class="ghost" onclick="markTaskDone(${t.id})">Done</button>
            <button class="ghost" onclick="editTask(${t.id}, '${escapeForJs(t.title)}')">Edit</button>
            <button class="ghost danger-text" onclick="deleteTask(${t.id})">Delete</button>
          </div>
        </div>
      `
            )
            .join("")
        : '<p class="muted">No tasks yet. Add your first task.</p>';

    const suggestionsHtml = data.suggestions.length
        ? data.suggestions.map((s) => `<p class="muted">💡 ${s}</p>`).join("")
        : "";

    $("taskList").innerHTML = tasksHtml + suggestionsHtml;
}

function detectTaskPriority(title) {
    const text = title.toLowerCase();

    const safetyWords = [
        "travel",
        "travelling",
        "alone",
        "night",
        "late",
        "cab",
        "taxi",
        "uber",
        "ola",
        "walk",
        "office",
        "home",
        "route",
        "sos",
        "emergency"
    ];

    const highWords = [
        "urgent",
        "important",
        "deadline",
        "submit",
        "final",
        "interview",
        "meeting",
        "today",
        "asap"
    ];

    const lowWords = [
        "drink water",
        "water",
        "stretch",
        "break",
        "snack",
        "music",
        "relax"
    ];

    const lateTimePattern = /(9|10|11|12)\s*(pm|p\.m\.|night)/i;

    if (safetyWords.some(word => text.includes(word)) || lateTimePattern.test(text)) {
        return "safety";
    }

    if (highWords.some(word => text.includes(word))) {
        return "high";
    }

    if (lowWords.some(word => text.includes(word))) {
        return "low";
    }

    return "medium";
}

function formatPriority(priority) {
    const labels = {
        low: "Low",
        medium: "Medium",
        high: "High",
        safety: "Safety"
    };

    return labels[priority] || "Medium";
}

function priorityClass(priority) {
    const classes = {
        low: "priority-low",
        medium: "priority-medium",
        high: "priority-high",
        safety: "priority-safety"
    };

    return classes[priority] || "priority-medium";
}

function formatStatus(status) {
    const labels = {
        pending: "Pending",
        done: "Done"
    };

    return labels[status] || status;
}

function escapeForJs(value) {
    return String(value || "")
        .replaceAll("\\", "\\\\")
        .replaceAll("'", "\\'")
        .replaceAll('"', "&quot;");
}

window.markTaskDone = async (id) => {
    await api("/api/tasks/" + id, {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify({ status: "done" })
    });

    loadTasks();
    toast("Task marked as done.");
};

window.editTask = async (id, oldTitle) => {
    const newTitle = prompt("Edit task title:", oldTitle);
    if (!newTitle || !newTitle.trim()) return;

    const priority = detectTaskPriority(newTitle.trim());

    await api("/api/tasks/" + id, {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify({
            title: newTitle.trim(),
            priority
        })
    });

    loadTasks();
    toast(`Task updated. Priority auto-detected as ${formatPriority(priority)}.`);
};

window.deleteTask = async (id) => {
    if (!confirm("Delete this task?")) return;

    await api("/api/tasks/" + id, {
        method: "DELETE",
        headers: authHeaders()
    });

    loadTasks();
    toast("Task deleted.");
};

/* ---------------- MOOD ---------------- */

$("analyzeMood").onclick = async () => {
    const moodScore = Number($("moodScore").value);
    const note = $("moodNote").value || "";
    const healthIssue = $("healthIssue") ? $("healthIssue").value : "";
    const otherHealthIssue = $("otherHealthIssue") ? $("otherHealthIssue").value : "";

    let data = {
        stress_level: "low",
        stress_score: 10,
        calm_mode: moodScore <= 2
    };

    try {
        data = await api("/api/mood/analyze", {
            method: "POST",
            headers: authHeaders(),
            body: JSON.stringify({
                mood_score: moodScore,
                note,
                health_issue: healthIssue,
                other_health_issue: otherHealthIssue
            })
        });
    } catch (err) {
        console.warn("Mood API failed, using local suggestions:", err.message);
    }

    const suggestions = getMoodSuggestions(moodScore, note);
    const healthSuggestions = getHealthSuggestions(healthIssue, otherHealthIssue);
    if ($("calmHealthSupport")) {
        $("calmHealthSupport").innerHTML = `
        <ul>
            ${healthSuggestions.map(x => `<li>${x}</li>`).join("")}
        </ul>
    `;
    }

    const html = `
        <div class="wellness-box">
            <h4>AI Wellness Coach</h4>

            <p>
                Mood: <b>${suggestions.mood}</b><br>
                Stress level: <b>${data.stress_level || "low"}</b> (${data.stress_score || 0}/100)
            </p>

            <h4>Mood-Based Suggestions</h4>
            <ul>
                ${suggestions.activities.map(x => `<li>${x}</li>`).join("")}
            </ul>

            <h4>Music Suggestions</h4>
            <div>
                ${suggestions.music.map(x => `<span class="pill">${x}</span>`).join("")}
            </div>

            <h4>Quick Care</h4>
            <ul>
                ${suggestions.care.map(x => `<li>${x}</li>`).join("")}
            </ul>

            <h4>Health Concern Support</h4>
            <ul>
                ${healthSuggestions.map(x => `<li>${x}</li>`).join("")}
            </ul>

            <p class="helper-text">
                These are general wellness suggestions, not medical advice. Please consult a doctor for severe or persistent symptoms.
            </p>

            <p class="helper-text">
                ${suggestions.openCalmMode
            ? "Smart Calm Mode is recommended and will open now."
            : "You look stable. Keep positive check-ins active."
        }
            </p>
        </div>
    `;

    if ($("moodResult")) {
        $("moodResult").innerHTML = html;
    }

    if ($("aiOutput")) {
        $("aiOutput").innerHTML = `<div class="card">${html}</div>`;
    }

    toast(`Mood analyzed: ${suggestions.mood}`);

    const shouldOpenCalm =
        suggestions.openCalmMode ||
        healthIssue === "anxiety" ||
        otherHealthIssue.toLowerCase().includes("panic") ||
        otherHealthIssue.toLowerCase().includes("anxiety") ||
        otherHealthIssue.toLowerCase().includes("stress");

    if (shouldOpenCalm) {
        setTimeout(() => {
            showPage("calm");
            toast("Smart Calm Mode opened based on mood or health concern.");
        }, 1000);
    }
};

function getHealthSuggestions(issue, otherIssue = "") {
    const custom = (otherIssue || "").toLowerCase();

    if (issue === "none") {
        return [
            "No health concerns detected.",
            "Maintain hydration and a balanced routine.",
            "Take short breaks and stay active.",
            "Enable safety mode if travelling."
        ];
    }

    if (!issue && !custom) {
        return [
            "No health concern selected.",
            "Continue regular hydration, balanced meals, and short movement breaks."
        ];
    }

    if (issue === "period_cramps" || custom.includes("cramp") || custom.includes("period")) {
        return [
            "Try gentle yoga poses like child pose, cat-cow stretch, or knees-to-chest.",
            "Use a warm compress on the lower abdomen if available.",
            "Drink warm water or herbal tea.",
            "Avoid intense exercise if pain is high.",
            "If pain is severe or unusual, consult a healthcare professional."
        ];
    }

    if (issue === "headache" || custom.includes("headache") || custom.includes("migraine")) {
        return [
            "Rest your eyes for 5 minutes and reduce screen brightness.",
            "Drink water slowly.",
            "Try neck and shoulder relaxation stretches.",
            "Move to a quiet, well-ventilated place.",
            "If headache is severe, sudden, or repeated, seek medical advice."
        ];
    }

    if (issue === "fatigue" || custom.includes("tired") || custom.includes("weak") || custom.includes("fatigue")) {
        return [
            "Take a short rest break.",
            "Eat a light snack such as fruit, nuts, or curd if available.",
            "Drink water or ORS if you feel dehydrated.",
            "Avoid unnecessary late travel when energy is low.",
            "Use live tracking if you need to travel."
        ];
    }

    if (issue === "anxiety" || custom.includes("anxiety") || custom.includes("panic") || custom.includes("stress")) {
        return [
            "Start 4-4-6 breathing in Calm Mode.",
            "Sit in a safe and well-lit place.",
            "Listen to meditation or soft instrumental music.",
            "Message or call a trusted contact if you feel unsafe.",
            "Use SOS if you feel immediate danger."
        ];
    }

    if (issue === "back_pain" || custom.includes("back pain") || custom.includes("back")) {
        return [
            "Try gentle seated forward bend or cat-cow stretch.",
            "Avoid lifting heavy items.",
            "Sit with back support.",
            "Take a slow 2-minute walk if comfortable.",
            "If pain is sharp or persistent, consult a healthcare professional."
        ];
    }

    if (issue === "pcos" || custom.includes("pcos")) {
        return [
            "Try light movement such as walking or gentle yoga.",
            "Prioritize hydration and balanced meals.",
            "Track mood, fatigue, and pain patterns.",
            "Avoid skipping meals when feeling weak.",
            "Consult a doctor for ongoing PCOS symptoms."
        ];
    }

    return [
        `For "${otherIssue || "this concern"}", take rest, hydrate, and avoid overexertion.`,
        "Try gentle breathing and light stretching.",
        "Use live tracking if travelling while uncomfortable.",
        "If symptoms are severe, unusual, or persistent, consult a healthcare professional."
    ];
}

function getMoodSuggestions(score, note = "") {
    const text = note.toLowerCase();

    if (score === 5) {
        return {
            mood: "Great",
            openCalmMode: false,
            activities: [
                "Continue your current routine.",
                "Plan one important task while your energy is high.",
                "Take a short walk to maintain momentum."
            ],
            music: [
                "Positive Bollywood",
                "90s Bollywood",
                "Upbeat pop",
                "Morning motivation"
            ],
            care: [
                "Stay hydrated.",
                "Do a quick gratitude note.",
                "Share your live trip if travelling later."
            ]
        };
    }

    if (score === 4) {
        return {
            mood: "Okay",
            openCalmMode: false,
            activities: [
                "Take a 5-minute reset break.",
                "Finish one small pending task.",
                "Prepare your travel plan in advance."
            ],
            music: [
                "Lo-fi beats",
                "Soft Bollywood",
                "Acoustic songs",
                "Light instrumental"
            ],
            care: [
                "Drink water.",
                "Stretch your neck and shoulders.",
                "Avoid rushing into late travel."
            ]
        };
    }

    if (score === 3 || text.includes("tired")) {
        return {
            mood: "Tired",
            openCalmMode: false,
            activities: [
                "Take a 10-minute rest.",
                "Do light stretching.",
                "Avoid unnecessary late-night travel.",
                "Reschedule low-priority tasks."
            ],
            music: [
                "Soft instrumental",
                "Rain sounds",
                "Calm acoustic",
                "Slow Bollywood"
            ],
            care: [
                "Drink water.",
                "Eat a light snack.",
                "Rest your eyes for 2 minutes.",
                "Enable trip tracking if you need to travel."
            ]
        };
    }

    if (score === 2) {
        return {
            mood: "Stressed",
            openCalmMode: true,
            activities: [
                "Start 4-4-6 breathing.",
                "Take a 5-minute break.",
                "Move to a quiet or well-lit place.",
                "Delay non-urgent tasks."
            ],
            music: [
                "Meditation music",
                "Instrumental calm",
                "Nature sounds",
                "Om chanting"
            ],
            care: [
                "Hydrate slowly.",
                "Relax your shoulders.",
                "Enable safety mode if travelling.",
                "Message a trusted contact if needed."
            ]
        };
    }

    return {
        mood: "Anxious",
        openCalmMode: true,
        activities: [
            "Start guided breathing immediately.",
            "Sit in a safe place.",
            "Avoid isolated routes.",
            "Enable live tracking before moving."
        ],
        music: [
            "Deep meditation",
            "432Hz calming tone",
            "Soft chanting",
            "Slow instrumental"
        ],
        care: [
            "Drink water.",
            "Call or message a trusted contact.",
            "Use SOS if you feel unsafe.",
            "Choose a brighter and crowded route."
        ]
    };
}

/* ---------------- ROUTE ---------------- */

$("scoreRoute").onclick = async () => {
    const pos = await getCurrentLocation().catch(
        () => currentPos || { lat: 18.5204, lng: 73.8567 }
    );

    const dest = await getDestination(pos);
    if (!dest) return;

    const body = {
        source_name: $("sourceName").value,
        destination_name: $("destName").value,
        start_lat: pos.lat,
        start_lng: pos.lng,
        dest_lat: dest.lat,
        dest_lng: dest.lng,
        mood_note: $("moodNote").value
    };

    const data = await api("/api/route/score", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(body)
    });

    $("routeResult").innerHTML = `
    <p>Risk: <b>${data.risk_label}</b> (${data.risk_score}/100)</p>
    ${data.reasons.map((r) => `<span class="pill">${r}</span>`).join("")}
    <ul>${data.safer_tips.map((t) => `<li>${t}</li>`).join("")}</ul>
  `;

    drawRoute(pos, dest);
};


/* ---------------- TRIP ---------------- */

$("startTrip").onclick = async () => {
    const pos = await getCurrentLocation().catch(
        () => currentPos || { lat: 18.5204, lng: 73.8567 }
    );

    if (!$("destName").value.trim() && !$("destLat").value.trim() && !$("destLng").value.trim()) {
        toast("Please enter a destination name or click on the map to set destination.");
        return;
    }

    const dest = await getDestination(pos);
    if (!dest) return;

    const body = {
        source_name: $("sourceName").value || "Current location",
        destination_name: $("destName").value || "Destination",
        start_lat: pos.lat,
        start_lng: pos.lng,
        dest_lat: dest.lat,
        dest_lng: dest.lng,
        mood_note: $("moodNote").value,
        checkin_minutes: Number($("checkinMinutes").value || 10)
    };

    const data = await api("/api/trips/start", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(body)
    });

    activeTripId = data.trip.id;

    if ($("tripStatus")) {
        $("tripStatus").textContent = "Live Tracking ON";
        $("tripStatus").className = "badge success";
    }

    connectWS(activeTripId);
    drawRoute(pos, dest);

    watchId = navigator.geolocation.watchPosition(
        async (p) => {
            const loc = {
                lat: p.coords.latitude,
                lng: p.coords.longitude,
                accuracy: p.coords.accuracy
            };

            currentPos = loc;

            if (map) {
                map.panTo([loc.lat, loc.lng]);
            }

            if (userMarker) {
                userMarker.setLatLng([loc.lat, loc.lng]);
            }

            await api(`/api/trips/${activeTripId}/location`, {
                method: "POST",
                headers: authHeaders(),
                body: JSON.stringify(loc)
            }).catch(console.error);
        },
        console.error,
        { enableHighAccuracy: true, maximumAge: 5000 }
    );

    toast(`Live Trip started. Risk score ${data.risk.risk_score}/100.`);
};

$("endTrip").onclick = async () => {
    if (!activeTripId) {
        if ($("tripStatus")) {
            $("tripStatus").textContent = "No Active Trip";
            $("tripStatus").className = "badge";
        }
        return toast("No active trip to end.");
    }

    try {
        await api(`/api/trips/${activeTripId}/end`, {
            method: "POST",
            headers: authHeaders()
        });

        if (watchId) {
            navigator.geolocation.clearWatch(watchId);
            watchId = null;
        }

        if (ws) {
            ws.close();
            ws = null;
        }

        activeTripId = null;

        if ($("tripStatus")) {
            $("tripStatus").textContent = "Trip Not Started";
            $("tripStatus").className = "badge";
        }

        toast("Trip ended safely.");
    } catch (err) {
        toast("Could not end trip: " + err.message);
    }
};

function connectWS(tripId) {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    ws = new WebSocket(`${proto}://${location.host}/ws/trips/${tripId}`);

    ws.onmessage = (ev) => {
        const data = JSON.parse(ev.data);

        if (data.type === "sos") {
            toast("SOS broadcast received for active trip.");
        }
    };
}

/* ---------------- SOS ---------------- */

window.callEmergency = (number) => {
    window.location.href = `tel:${number}`;
};

let sosAudioCtx = null;
let sosOscillator = null;
let sosGain = null;

function startSosVisual() {
    const overlay = $("sosOverlay");
    if (overlay) overlay.classList.remove("hidden");

    try {
        sosAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
        sosOscillator = sosAudioCtx.createOscillator();
        sosGain = sosAudioCtx.createGain();

        sosOscillator.type = "sawtooth";
        sosOscillator.frequency.value = 880;
        sosGain.gain.value = 0.08;

        sosOscillator.connect(sosGain).connect(sosAudioCtx.destination);
        sosOscillator.start();
    } catch (e) {
        console.warn("Siren audio blocked:", e);
    }
}

function stopSosVisual() {
    const overlay = $("sosOverlay");
    if (overlay) overlay.classList.add("hidden");

    if (sosOscillator) {
        sosOscillator.stop();
        sosOscillator = null;
    }

    if (sosAudioCtx) {
        sosAudioCtx.close();
        sosAudioCtx = null;
    }
}


async function triggerSOS(source = "button") {
    startSosVisual();

    try {
        const pos = await getCurrentLocation().catch(() => currentPos || {});

        const data = await api("/api/sos/trigger", {
            method: "POST",
            headers: authHeaders(),
            body: JSON.stringify({
                trip_id: activeTripId,
                lat: pos.lat,
                lng: pos.lng,
                trigger_type: source,
                message: "Emergency help requested from HerSafe+."
            })
        });

        toast(
            `SOS triggered. Contacts notified: ${data.contacts_notified}. SMS status: ${data.sms.status}.`
        );
    } catch (err) {
        toast("SOS visual activated, but backend alert failed: " + err.message);
    }

    setTimeout(stopSosVisual, 10000);
}

$("sosTop").onclick = () => triggerSOS("dashboard");
$("sosTrip").onclick = () => triggerSOS("trip");

/* ---------------- SETTINGS ---------------- */

$("settingsForm").onsubmit = async (e) => {
    e.preventDefault();

    const body = {
        sms_enabled: $("smsEnabled").checked,
        browser_enabled: $("browserEnabled").checked,
        auto_safety_mode: $("autoSafetyMode").checked,
        calm_mode_enabled: $("calmModeEnabled").checked,
        checkin_minutes: Number($("checkinMinutes").value || 10)
    };

    await api("/api/settings", {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify(body)
    });

    toast("Settings saved.");
};

async function loadSettings() {
    const s = await api("/api/settings", { headers: authHeaders() }).catch(() => null);
    if (!s) return;

    $("smsEnabled").checked = s.sms_enabled;
    $("browserEnabled").checked = s.browser_enabled;
    $("autoSafetyMode").checked = s.auto_safety_mode;
    $("calmModeEnabled").checked = s.calm_mode_enabled;
    $("checkinMinutes").value = s.checkin_minutes;
}

/* ---------------- CALM MODE ---------------- */

$("safetyFromCalm").onclick = () => {
    showPage("trip");
    toast("Safety Mode ready. Start live trip tracking when you leave.");
};

let breathingInterval = null;

$("startBreathing").onclick = () => {
    const circle = $("breathCircle");
    const text = $("breathText");

    let phase = 0;

    clearInterval(breathingInterval);

    function updateBreathing() {
        if (phase === 0) {
            circle.style.transform = "scale(1.1)";
            text.textContent = "Inhale...";
        } else if (phase === 1) {
            circle.style.transform = "scale(1.1)";
            text.textContent = "Hold...";
        } else {
            circle.style.transform = "scale(0.85)";
            text.textContent = "Exhale...";
        }

        phase = (phase + 1) % 3;
    }

    updateBreathing();
    breathingInterval = setInterval(updateBreathing, 4000);

    toast("Breathing guide started");
};

$("stopBreathing").onclick = () => {
    clearInterval(breathingInterval);
    $("breathCircle").style.transform = "scale(1)";
    $("breathText").textContent = "Inhale 4 sec · Hold 4 sec · Exhale 6 sec";
    toast("Breathing stopped");
};

let audioPlayer = null;

$("playTone").onclick = () => {
    const type = $("musicType").value;

    if (audioPlayer) {
        audioPlayer.pause();
    }

    let url = "";

    if (type === "meditation") {
        url = "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3";
    } else if (type === "rain") {
        url = "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-8.mp3";
    } else {
        url = "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-10.mp3";
    }

    audioPlayer = new Audio(url);
    audioPlayer.loop = true;
    audioPlayer.volume = 0.4;
    audioPlayer.play();

    toast("Playing calm sound");
};

$("stopTone").onclick = () => {
    if (audioPlayer) {
        audioPlayer.pause();
        audioPlayer = null;
        toast("Sound stopped");
    }
};

/* ---------------- INIT ---------------- */

window.addEventListener("load", () => {
    setLoggedIn(Boolean(token));
    updateNotificationUI();

    if ($("stopSosVisual")) {
        $("stopSosVisual").onclick = stopSosVisual;
    }
});