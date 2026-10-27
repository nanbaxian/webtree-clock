(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const STORE = {
    alarms: "smartclock.alarms",
    world: "smartclock.world",
    theme: "smartclock.theme",
  };

  // ---------- storage (every access guarded: storage can be blocked) ----------
  const load = (key, fallback) => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  };
  const save = (key, value) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* storage unavailable: state lives for this page session only */
    }
  };

  const pad = (n) => String(n).padStart(2, "0");
  const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

  // ---------- greeting, date, time zone, week progress ----------
  const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const dateFmt = new Intl.DateTimeFormat(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });

  function greetingFor(hour) {
    if (hour < 5) return "Good night";
    if (hour < 12) return "Good morning";
    if (hour < 18) return "Good afternoon";
    return "Good evening";
  }

  function renderClock(now) {
    $("time").textContent = timeFmt.format(now);
    $("date").textContent = dateFmt.format(now);
    $("greeting").textContent = greetingFor(now.getHours());
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "local";
    $("tz").textContent = tz.replace(/_/g, " ");
    const weekday = now.getDay() === 0 ? 7 : now.getDay();
    const weekPct = Math.round(((weekday - 1 + now.getHours() / 24) / 7) * 100);
    $("weekProgress").textContent = `Week ${weekPct}% done`;
  }

  // ---------- alarms ----------
  let alarms = load(STORE.alarms, []);
  let selectedDays = new Set();
  let ringing = null; // { label, time, alarmId }

  function buildDayPicks() {
    const wrap = $("dayPicks");
    DAYS.forEach((name, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = name[0];
      b.title = name;
      b.setAttribute("aria-label", name);
      b.addEventListener("click", () => {
        if (selectedDays.has(i)) selectedDays.delete(i);
        else selectedDays.add(i);
        b.classList.toggle("on", selectedDays.has(i));
      });
      wrap.appendChild(b);
    });
  }

  function describeDays(days) {
    if (!days.length) return "Once";
    if (days.length === 7) return "Every day";
    const sorted = [...days].sort((a, b) => a - b);
    if (sorted.join() === "1,2,3,4,5") return "Weekdays";
    if (sorted.join() === "0,6") return "Weekends";
    return sorted.map((d) => DAYS[d]).join(" ");
  }

  // Next moment an enabled alarm will ring, or null.
  function nextOccurrence(alarm, now) {
    const [h, m] = alarm.time.split(":").map(Number);
    for (let d = 0; d <= 8; d++) {
      const c = new Date(now);
      c.setDate(now.getDate() + d);
      c.setHours(h, m, 0, 0);
      if (c <= now) continue;
      if (alarm.days.length && !alarm.days.includes(c.getDay())) continue;
      return c;
    }
    return null;
  }

  function renderNextAlarm(now) {
    let best = null;
    let bestAlarm = null;
    for (const a of alarms) {
      if (!a.enabled) continue;
      const t = nextOccurrence(a, now);
      if (t && (!best || t < best)) {
        best = t;
        bestAlarm = a;
      }
    }
    if (!best) {
      $("nextAlarm").textContent = "No alarms set";
      return;
    }
    const diffMin = Math.round((best - now) / 60000);
    const when = diffMin < 60
      ? `in ${diffMin} min`
      : `in ${Math.floor(diffMin / 60)} h ${diffMin % 60} min`;
    $("nextAlarm").textContent = `Next: ${bestAlarm.time}${bestAlarm.label ? " · " + bestAlarm.label : ""} (${when})`;
  }

  function renderAlarms() {
    const list = $("alarmList");
    list.innerHTML = "";
    if (!alarms.length) {
      list.innerHTML = '<li class="item-sub">No alarms yet. Add one above.</li>';
      return;
    }
    alarms
      .slice()
      .sort((a, b) => a.time.localeCompare(b.time))
      .forEach((a) => {
        const li = document.createElement("li");

        const info = document.createElement("div");
        const t = document.createElement("div");
        t.className = "item-time";
        t.textContent = a.time;
        const sub = document.createElement("div");
        sub.className = "item-sub";
        sub.textContent = [a.label, describeDays(a.days)].filter(Boolean).join(" · ");
        info.append(t, sub);

        const sw = document.createElement("label");
        sw.className = "switch";
        sw.title = a.enabled ? "Disable" : "Enable";
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = a.enabled;
        cb.addEventListener("change", () => {
          a.enabled = cb.checked;
          persistAlarms();
        });
        const track = document.createElement("span");
        sw.append(cb, track);

        const del = document.createElement("button");
        del.className = "remove-btn";
        del.textContent = "Delete";
        del.addEventListener("click", () => {
          alarms = alarms.filter((x) => x.id !== a.id);
          persistAlarms();
        });

        li.append(info, sw, del);
        list.appendChild(li);
      });
  }

  function persistAlarms() {
    save(STORE.alarms, alarms);
    renderAlarms();
    renderNextAlarm(new Date());
  }

  $("alarmForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const time = $("alarmTime").value;
    if (!time) return;
    alarms.push({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      time,
      label: $("alarmLabel").value.trim(),
      days: [...selectedDays].sort((a, b) => a - b),
      enabled: true,
      lastFired: null,
    });
    $("alarmLabel").value = "";
    persistAlarms();
  });

  // ---------- audio (Web Audio beep, started after a user gesture) ----------
  let audioCtx = null;
  let beepTimer = null;

  function beepOnce() {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.3, audioCtx.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.4);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.45);
    } catch {
      /* no audio support: the visual alert still shows */
    }
  }

  function startRinging(label, time, alarmId) {
    if (ringing) return; // one alert at a time
    ringing = { label, time, alarmId };
    $("ringTitle").textContent = label || "Alarm";
    $("ringTime").textContent = time;
    $("ring").classList.remove("hidden");
    beepOnce();
    beepTimer = setInterval(beepOnce, 900);
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification("Smart Clock", { body: `${label || "Alarm"} · ${time}` });
    }
  }

  function stopRinging() {
    clearInterval(beepTimer);
    beepTimer = null;
    $("ring").classList.add("hidden");
    ringing = null;
  }

  $("dismiss").addEventListener("click", () => {
    if (!ringing) return;
    const a = alarms.find((x) => x.id === ringing.alarmId);
    if (a && !a.days.length) a.enabled = false; // one-time alarms switch off
    stopRinging();
    persistAlarms();
  });

  $("snooze").addEventListener("click", () => {
    if (!ringing) return;
    const snoozeAt = new Date(Date.now() + 5 * 60000);
    alarms.push({
      id: "snz" + Date.now().toString(36),
      time: hm(snoozeAt),
      label: "Snooze: " + (ringing.label || "Alarm"),
      days: [],
      enabled: true,
      lastFired: null,
    });
    const a = alarms.find((x) => x.id === ringing.alarmId);
    if (a && !a.days.length) a.enabled = false;
    stopRinging();
    persistAlarms();
  });

  // Checks once per second; fires each alarm at most once per matching minute.
  function checkAlarms(now) {
    const key = now.toDateString() + " " + hm(now);
    let changed = false;
    for (const a of alarms) {
      if (!a.enabled || a.time !== hm(now)) continue;
      if (a.days.length && !a.days.includes(now.getDay())) continue;
      if (a.lastFired === key) continue;
      a.lastFired = key;
      changed = true;
      startRinging(a.label, a.time, a.id);
      break;
    }
    if (changed) save(STORE.alarms, alarms);
  }

  // ---------- timer ----------
  let timerLeft = 5 * 60 * 1000;
  let timerEnd = null;
  let timerInterval = null;

  const fmtDuration = (ms, withHours = true) => {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return withHours ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  };

  function timerInputMs() {
    const m = Math.min(999, Math.max(0, parseInt($("timerMin").value, 10) || 0));
    const s = Math.min(59, Math.max(0, parseInt($("timerSec").value, 10) || 0));
    return (m * 60 + s) * 1000;
  }

  function renderTimer() {
    const ms = timerEnd ? timerEnd - Date.now() : timerLeft;
    $("timerDisplay").textContent = fmtDuration(ms);
  }

  function tickTimer() {
    renderTimer();
    if (timerEnd && timerEnd - Date.now() <= 0) {
      timerEnd = null;
      timerLeft = timerInputMs();
      clearInterval(timerInterval);
      timerInterval = null;
      $("timerStart").textContent = "Start";
      startRinging("Timer finished", fmtDuration(0), null);
    }
  }

  $("timerStart").addEventListener("click", () => {
    if (timerEnd) {
      // pause
      timerLeft = timerEnd - Date.now();
      timerEnd = null;
      clearInterval(timerInterval);
      timerInterval = null;
      $("timerStart").textContent = "Resume";
      renderTimer();
      return;
    }
    if (timerLeft <= 0) timerLeft = timerInputMs();
    if (timerLeft <= 0) return;
    timerEnd = Date.now() + timerLeft;
    $("timerStart").textContent = "Pause";
    timerInterval = setInterval(tickTimer, 250);
    tickTimer();
  });

  $("timerReset").addEventListener("click", () => {
    clearInterval(timerInterval);
    timerInterval = null;
    timerEnd = null;
    timerLeft = timerInputMs();
    $("timerStart").textContent = "Start";
    renderTimer();
  });

  ["timerMin", "timerSec"].forEach((id) =>
    $(id).addEventListener("change", () => {
      if (!timerEnd) {
        timerLeft = timerInputMs();
        renderTimer();
      }
    })
  );

  // ---------- stopwatch ----------
  let swElapsed = 0;
  let swStart = null;
  let swInterval = null;
  const laps = [];

  const fmtStopwatch = (ms) => {
    const cs = Math.floor(ms / 10);
    const m = Math.floor(cs / 6000);
    const s = Math.floor((cs % 6000) / 100);
    const c = cs % 100;
    return `${pad(m)}:${pad(s)}.${pad(c)}`;
  };

  function renderStopwatch() {
    const ms = swElapsed + (swStart ? Date.now() - swStart : 0);
    $("swDisplay").textContent = fmtStopwatch(ms);
  }

  function renderLaps() {
    const ol = $("laps");
    ol.innerHTML = "";
    laps.forEach((ms, i) => {
      const li = document.createElement("li");
      const label = document.createElement("span");
      label.textContent = `Lap ${laps.length - i}`;
      const val = document.createElement("span");
      val.textContent = fmtStopwatch(ms);
      li.append(label, val);
      ol.appendChild(li);
    });
  }

  $("swToggle").addEventListener("click", () => {
    if (swStart) {
      swElapsed += Date.now() - swStart;
      swStart = null;
      clearInterval(swInterval);
      swInterval = null;
      $("swToggle").textContent = "Start";
    } else {
      swStart = Date.now();
      swInterval = setInterval(renderStopwatch, 50);
      $("swToggle").textContent = "Stop";
    }
    renderStopwatch();
  });

  $("swLap").addEventListener("click", () => {
    if (!swStart && !swElapsed) return;
    laps.unshift(swElapsed + (swStart ? Date.now() - swStart : 0));
    renderLaps();
  });

  $("swReset").addEventListener("click", () => {
    clearInterval(swInterval);
    swInterval = null;
    swStart = null;
    swElapsed = 0;
    laps.length = 0;
    $("swToggle").textContent = "Start";
    renderLaps();
    renderStopwatch();
  });

  // ---------- world clocks ----------
  let worldZones = load(STORE.world, null);
  if (!Array.isArray(worldZones)) worldZones = ["UTC"];

  function zoneOptions() {
    const zones = typeof Intl.supportedValuesOf === "function"
      ? Intl.supportedValuesOf("timeZone")
      : ["UTC", "America/New_York", "Europe/London", "Europe/Paris", "Asia/Tokyo", "Asia/Shanghai", "Australia/Sydney"];
    const sel = $("worldZone");
    zones.forEach((z) => {
      const o = document.createElement("option");
      o.value = z;
      o.textContent = z.replace(/_/g, " ");
      sel.appendChild(o);
    });
    sel.value = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  }

  function renderWorld(now) {
    const list = $("worldList");
    list.innerHTML = "";
    if (!worldZones.length) {
      list.innerHTML = '<li class="item-sub">No clocks yet. Add a time zone above.</li>';
      return;
    }
    worldZones.forEach((zone) => {
      const li = document.createElement("li");
      const info = document.createElement("div");
      const name = document.createElement("div");
      name.className = "item-sub";
      name.textContent = zone.replace(/_/g, " ");
      const t = document.createElement("div");
      t.className = "item-time";
      t.textContent = new Intl.DateTimeFormat(undefined, { timeZone: zone, hour: "2-digit", minute: "2-digit" }).format(now);
      const day = document.createElement("div");
      day.className = "item-sub";
      day.textContent = new Intl.DateTimeFormat(undefined, { timeZone: zone, weekday: "short", day: "numeric", month: "short" }).format(now);
      info.append(t, name, day);
      const del = document.createElement("button");
      del.className = "remove-btn";
      del.textContent = "Remove";
      del.addEventListener("click", () => {
        worldZones = worldZones.filter((z) => z !== zone);
        save(STORE.world, worldZones);
        renderWorld(new Date());
      });
      li.append(info, del);
      list.appendChild(li);
    });
  }

  $("worldForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const zone = $("worldZone").value;
    if (zone && !worldZones.includes(zone)) {
      worldZones.push(zone);
      save(STORE.world, worldZones);
      renderWorld(new Date());
    }
  });

  // ---------- tabs ----------
  document.querySelectorAll(".tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((b) => {
        b.classList.toggle("active", b === btn);
        b.setAttribute("aria-selected", String(b === btn));
      });
      document.querySelectorAll(".panel").forEach((p) => p.classList.add("hidden"));
      $("panel-" + btn.dataset.tab).classList.remove("hidden");
    });
  });

  // ---------- theme & fullscreen ----------
  const root = document.documentElement;
  const savedTheme = load(STORE.theme, null);
  if (savedTheme) root.dataset.theme = savedTheme;

  $("themeBtn").addEventListener("click", () => {
    const dark = root.dataset.theme === "dark" ||
      (!root.dataset.theme && window.matchMedia("(prefers-color-scheme: dark)").matches);
    root.dataset.theme = dark ? "light" : "dark";
    save(STORE.theme, root.dataset.theme);
  });

  $("fullscreenBtn").addEventListener("click", () => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.();
  });

  // ---------- main loop ----------
  function tick() {
    const now = new Date();
    renderClock(now);
    checkAlarms(now);
    renderNextAlarm(now);
    renderWorld(now);
  }

  buildDayPicks();
  zoneOptions();
  renderAlarms();
  renderLaps();
  renderTimer();
  renderStopwatch();
  tick();
  setInterval(tick, 1000);

  if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission().catch(() => {});
  }
})();
