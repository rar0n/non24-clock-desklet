// Non-24 Clock desklet for Cinnamon (Linux Mint)
//
// Same clock model as the Android app (ClockMath in Non24Clock.kt):
//
//  - An "anchor": at real instant anchorMs the clock stood at anchorPos24, the position
//    in the Non-24 day on a 0..24 scale (0 = Non-24 midnight, 12 = halfway through).
//  - One Non-24 day lasts `period` real hours (the day-length setting).
//  - Mars-style shows pos24 as is (always 0..24, hours stretched/compressed).
//    Wrap-around shows pos24/24*period: normal-length hours that wrap at the day
//    length, so it can show values above 24 (e.g. 24:17 on a 24h30m day).
//
// Switching mode never moves Non-24 midnight. Changing the day length does not make the
// reading jump: wrap-around keeps the hours since midnight (wrapping, and advancing the day,
// only if they no longer fit), Mars-style keeps the fraction of the day (see _syncPeriod).
// Setting a time re-anchors at "now".

const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const Clutter = imports.gi.Clutter;
const Mainloop = imports.mainloop;
const Settings = imports.ui.settings;
const Main = imports.ui.main;
const GLib = imports.gi.GLib;

const TICK_MS = 250;
const HOUR_MS = 3600000;
// A typed day length is applied this long after the last keystroke.
const LENGTH_APPLY_DELAY_MS = 1200;
// Writes that must show up in an open settings window wait this long (it ignores file
// changes for ~2 s after its own saves).
const SETTINGS_SYNC_DELAY_MS = 2600;
const MIN_DAY_HOURS = 1;
// Far beyond any real day; just keeps the arithmetic exact to the second (1e9 h = 3.6e12 s)
// and the clock text a sane length.
const MAX_DAY_HOURS = 1e9;

// Mean solar day of each planet in real seconds (sunrise to sunrise), keys matching the
// "planet" setting. Derived as 1 / |1/P_rot - 1/P_orb| from the sidereal rotation period
// (IAU WGCCRE 2015 rotation rates; Jupiter System III) and the sidereal orbital period
// (JPL, in Julian years of 365.25 d). Venus and Uranus rotate retrograde, which makes
// their solar day shorter than the sidereal one. Mars is the official sol; the derivation
// reproduces it to 0.5 ms. Mercury is good to about a minute (orbital period precision),
// the others to the second or better, apart from the rotation ambiguities noted in the
// README (Saturn, Neptune). The Moon's day is its synodic month (new moon to new moon),
// Pluto uses the IAU rotation rate, and "planetx" is a made-up 25.25 h placeholder.
const PLANET_DAY_SECONDS = {
    "mercury": 15201129.4,   // 4222:32:09.4  (175.939 d)
    "venus": 10087240.9,     // 2802:00:40.9  (116.750 d)
    "earth": 86400,          // 24:00:00
    "moon": 2551442.88,      // 708:44:02.88  (mean synodic month, 29.530588853 d)
    "mars": 88775.244,       // 24:39:35.244
    "jupiter": 35733.12,     // 9:55:33.12
    "saturn": 38363.98,      // 10:39:23.98
    "uranus": 62062.55,      // 17:14:22.55
    "neptune": 57479.32,     // 15:57:59.32
    "pluto": 551817.14,      // 153:16:57.14  (dwarf planet; 6.3868 d, retrograde)
    "planetx": 90900         // 25:15:00      (placeholder)
};

// settings-schema key -> property name on the desklet (read-only for us)
const SETTING_KEYS = {
    "mode": "mode",
    "show-seconds": "showSeconds",
    "show-day": "showDay",
    "show-real": "showReal",
    "set-time-text": "setTimeText",
    "sync-seconds": "syncSeconds",
    "font-family": "fontFamily",
    "custom-font": "customFont",
    "show-unlit": "showUnlit",
    "shape-zero-slashed": "slashedZero",
    "shape-six-tailless": "sixTailless",
    "shape-seven-three": "sevenThree",
    "shape-nine-tailless": "nineTailless",
    "font-size": "fontSize",
    "text-color": "textColor",
    "earth-color": "earthColor",
    "background-color": "bgColor",
    "corner-radius": "cornerRadius"
};

// The anchor, persisted by us (hidden "generic" settings)
const ANCHOR_KEYS = {
    "anchor-ms": "anchorMs",         // real instant of the anchor (epoch ms)
    "anchor-pos24": "anchorPos24",   // position in the Non-24 day at that instant, 0..24
    "anchor-period": "anchorPeriod", // day length (real hours) the anchor was made under
    "anchor-day": "anchorDay"        // day number at the anchor
};

function pad(n) {
    return n < 10 ? "0" + n : String(n);
}

function wrap24(h) {
    return ((h % 24) + 24) % 24;
}

function localMidnightMs() {
    let d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
}

// Local UTC offset of date `d` as "UTC+2", "UTC-5", "UTC+5:30" (follows daylight saving time).
function utcLabel(d) {
    let off = -d.getTimezoneOffset();
    let sign = off < 0 ? "-" : "+";
    off = Math.abs(off);
    let h = Math.floor(off / 60);
    let m = off % 60;
    return "UTC" + sign + h + (m ? ":" + pad(m) : "");
}

// "HH:MM" or "HH:MM:SS" -> seconds, or null if invalid
function parseHMS(str) {
    let m = /^\s*(\d+):(\d{1,2})(?::(\d{1,2}))?\s*$/.exec(str || "");
    if (!m)
        return null;
    let h = parseInt(m[1], 10);
    let min = parseInt(m[2], 10);
    let s = m[3] === undefined ? 0 : parseInt(m[3], 10);
    if (min > 59 || s > 59)
        return null;
    return h * 3600 + min * 60 + s;
}

// Day length text -> real hours, or null if invalid. Accepted forms:
//   24.5            decimal hours
//   24:30           hours:minutes
//   24:30.5         hours:minutes, fractional minutes
//   24:39:35.244    hours:minutes:seconds, fractional seconds
// Only the last field may have a fraction; minutes and seconds must be below 60.
// A comma is accepted as the decimal separator. Result must be 1..96 hours.
function parseDayLength(str) {
    let s = String(str === undefined || str === null ? "" : str).trim().replace(/,/g, ".");
    if (!s)
        return null;
    let parts = s.split(":");
    if (parts.length > 3)
        return null;
    let num = /^(\d+(\.\d*)?|\.\d+)$/;
    for (let i = 0; i < parts.length; i++) {
        if (!num.test(parts[i]))
            return null;
        if (i < parts.length - 1 && parts[i].indexOf(".") >= 0)
            return null;
    }
    let v = parts.map(Number);
    if (v.length >= 2 && v[1] >= 60)
        return null;
    if (v.length === 3 && v[2] >= 60)
        return null;
    let hours = v[0] + (v[1] || 0) / 60 + (v[2] || 0) / 3600;
    if (!(hours >= MIN_DAY_HOURS && hours <= MAX_DAY_HOURS))
        return null;
    return hours;
}

// Seconds -> day length text "h:mm:ss[.fff]" (to the millisecond, no trailing zeros), the
// form the day-length field accepts: 88775.244 -> "24:39:35.244", 86400 -> "24:00:00".
function secondsToDayLengthText(seconds) {
    let ms = Math.round(seconds * 1000);
    let h = Math.floor(ms / 3600000);
    let m = Math.floor(ms / 60000) % 60;
    let s = Math.floor(ms / 1000) % 60;
    let frac = ms % 1000;
    let text = h + ":" + pad(m) + ":" + pad(s);
    if (frac)
        text += "." + padTo(frac, 3).replace(/0+$/, "");
    return text;
}

// A time set via 0..24 scaling and shown back can land a few 1e-11 s below the second it
// was set to (24:29:59 reading 24:29:58); a microsecond of tolerance makes it round-trip.
const EPS_SECONDS = 1e-6;

// Zero-pad a whole number to at least `digits` digits.
function padTo(n, digits) {
    let s = String(n);
    while (s.length < digits)
        s = "0" + s;
    return s;
}

// Digits the hour field needs for a display that wraps at `length` hours: exactly enough
// for the largest hour it can show, so the clock keeps a fixed width. A 9.9 h day needs 1
// (up to 9:53:59), a 26 h day 2 (up to 25:59:59), a 4222.6 h day 4 (up to 4222:35:59).
function hourDigitsFor(length) {
    let maxSeconds = Math.max(0, Math.ceil(length * 3600 - EPS_SECONDS) - 1);
    return String(Math.floor(maxSeconds / 3600)).length;
}

function formatHms(hours, hourDigits) {
    let total = Math.floor(hours * 3600 + EPS_SECONDS);
    return padTo(Math.floor(total / 3600), hourDigits) + ":" + pad(Math.floor(total / 60) % 60) + ":" + pad(total % 60);
}

function formatHm(hours, hourDigits) {
    let total = Math.floor(hours * 60 + EPS_SECONDS / 60);
    return padTo(Math.floor(total / 60), hourDigits) + ":" + pad(total % 60);
}

// ---- DSEG digit shapes -----------------------------------------------------------------
// DSEG (v0.50 and newer, 7 and 14 segment) addresses single segments through the Braille
// block: U+2800 + bit mask, bits 0..6 = segments a..g (bit 6 = both middle halves in DSEG14).
// Same characters as ClockFace.kt in the Android app.

function segChar(segments) {
    let mask = 0;
    for (let s of segments)
        mask |= 1 << (s.charCodeAt(0) - 97); // a = bit 0 ... g = bit 6
    return String.fromCharCode(0x2800 + mask);
}

const SEG_ZERO_PLAIN = segChar("abcdef");  // 0 without the DSEG14 diagonal
const SEG_SIX_NO_A = segChar("cdefg");     // 6 without top segment a
const SEG_SEVEN_ABC = segChar("abc");      // 7 = a, b, c (DSEG's default adds f)
const SEG_NINE_NO_D = segChar("abcfg");    // 9 without bottom segment d

// opts: is14, slashedZero, sixTailless, sevenThree, nineTailless
function segmentText(text, opts) {
    let out = "";
    for (let c of text) {
        if (c === "0" && opts.is14 && !opts.slashedZero)
            out += SEG_ZERO_PLAIN;
        else if (c === "6" && opts.sixTailless)
            out += SEG_SIX_NO_A;
        else if (c === "7" && opts.sevenThree)
            out += SEG_SEVEN_ABC;
        else if (c === "9" && opts.nineTailless)
            out += SEG_NINE_NO_D;
        else
            out += c;
    }
    return out;
}

// Lower-cased family names of installed fonts that contain the Braille block (U+2800),
// as { name: true }, or null if fontconfig can't be queried.
function fontsWithSegmentGlyphs() {
    try {
        let [ok, out] = GLib.spawn_sync(null,
            ["fc-list", "-f", "%{family}\\n", ":charset=2800"],
            null, GLib.SpawnFlags.SEARCH_PATH, null);
        if (!ok)
            return null;
        let text = (typeof out === "string") ? out : imports.byteArray.toString(out);
        let families = {};
        for (let line of text.split("\n")) {
            for (let name of line.split(",")) {
                name = name.trim().toLowerCase();
                if (name)
                    families[name] = true;
            }
        }
        return families;
    } catch (e) {
        return null;
    }
}

function fontHasSegmentGlyphs(font) {
    let families = fontsWithSegmentGlyphs();
    if (families === null)
        return true; // can't check: assume the font is fine
    return !!families[font.toLowerCase()];
}

function Non24Desklet(metadata, desklet_id) {
    this._init(metadata, desklet_id);
}

Non24Desklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init: function(metadata, desklet_id) {
        Desklet.Desklet.prototype._init.call(this, metadata, desklet_id);

        this._timeoutId = 0;
        this._lengthTimeoutId = 0;
        this._syncTimeoutId = 0;
        this._pendingSync = null;
        // Cinnamon invokes the settings button's callback by name; make sure `this` is right.
        this.on_set_time_pressed = this.on_set_time_pressed.bind(this);
        this.on_set_local_time_pressed = this.on_set_local_time_pressed.bind(this);
        this.on_align_seconds_pressed = this.on_align_seconds_pressed.bind(this);

        this.settings = new Settings.DeskletSettings(this, metadata["uuid"], desklet_id);
        let onChanged = () => this._restyleAndRefresh(true);
        for (let key in SETTING_KEYS) {
            this.settings.bindProperty(Settings.BindingDirection.IN,
                key, SETTING_KEYS[key], onChanged, null);
        }
        for (let key in ANCHOR_KEYS) {
            this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL,
                key, ANCHOR_KEYS[key], null, null);
        }
        // The day-length field is the single source of the day length. Picking a planet fills
        // it in; editing it sets the planet preset back to "custom". Both are bidirectional
        // because the desklet writes them too.
        this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL,
            "day-length", "dayLength", () => this._onDayLengthChanged(), null);
        this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL,
            "planet", "planet", () => this._onPlanetChanged(), null);
        this._appliedPeriod = parseDayLength(this.dayLength);
        // Settings saved with a planet chosen: make the field match it.
        if (PLANET_DAY_SECONDS[this.planet])
            this._applyPlanet(true);
        this._initAnchor();

        this._buildUi();
        this._restyleAndRefresh();

        this._timeoutId = Mainloop.timeout_add(TICK_MS, () => {
            this._refresh();
            return true;
        });
    },

    // ---- clock model (mirrors ClockMath in the Android app) -------------------------

    // Configured day length in real hours: the last valid value of the day-length field; if
    // the saved text is unreadable at startup, the length the anchor was made under, else 24.
    _periodHours: function() {
        return this._appliedPeriod || this.anchorPeriod || 24;
    },

    // A planet is chosen: use its day length right away, and write it into the field.
    // immediate: write the field now (startup); otherwise after a delay, see _scheduleSync.
    _applyPlanet: function(immediate) {
        let seconds = PLANET_DAY_SECONDS[this.planet];
        if (!seconds)
            return;
        if (this._lengthTimeoutId) {
            Mainloop.source_remove(this._lengthTimeoutId);
            this._lengthTimeoutId = 0;
        }
        this._appliedPeriod = seconds / 3600;
        if (immediate) {
            this._cancelSync();
            this.dayLength = secondsToDayLengthText(seconds);
        } else {
            this._scheduleSync("field");
        }
    },

    // The settings window ignores changes to the settings file for about 2 s after it saved
    // one itself. A value we write inside that window is stored but the open window never
    // shows it (it appears only after closing and reopening it). So the two cross-updates,
    // planet chosen -> fill the field, field edited -> planet back to "custom", are written
    // after SETTINGS_SYNC_DELAY_MS, once the window is listening again. The clock itself
    // does not wait: _appliedPeriod is updated at once.
    _scheduleSync: function(kind) {
        this._cancelSync();
        this._pendingSync = kind;
        this._syncTimeoutId = Mainloop.timeout_add(SETTINGS_SYNC_DELAY_MS, () => {
            this._syncTimeoutId = 0;
            let pending = this._pendingSync;
            this._pendingSync = null;
            let seconds = PLANET_DAY_SECONDS[this.planet];
            if (pending === "field" && seconds)
                this.dayLength = secondsToDayLengthText(seconds);
            else if (pending === "planet")
                this.planet = "custom";
            return false;
        });
    },

    _cancelSync: function() {
        if (this._syncTimeoutId) {
            Mainloop.source_remove(this._syncTimeoutId);
            this._syncTimeoutId = 0;
        }
        this._pendingSync = null;
    },

    _onPlanetChanged: function() {
        if (PLANET_DAY_SECONDS[this.planet])
            this._applyPlanet(false);
        else
            this._cancelSync(); // "custom": nothing to fill in
        this._restyleAndRefresh(true);
    },

    // The day-length field changed: by the user, or by our own delayed write of a planet's value.
    _onDayLengthChanged: function() {
        let seconds = PLANET_DAY_SECONDS[this.planet];
        if (seconds) {
            let typed = parseDayLength(this.dayLength);
            if (typed !== null && Math.abs(typed - seconds / 3600) < 1e-9) {
                this._cancelSync(); // that is the planet's own value, nothing was edited
                return;
            }
            this._scheduleSync("planet"); // edited by hand: no planet matches any more
        }
        this._scheduleLengthApply();
    },

    // Applies the typed day length once typing pauses.
    _scheduleLengthApply: function() {
        if (this._lengthTimeoutId)
            Mainloop.source_remove(this._lengthTimeoutId);
        this._lengthTimeoutId = Mainloop.timeout_add(LENGTH_APPLY_DELAY_MS, () => {
            this._lengthTimeoutId = 0;
            let hours = parseDayLength(this.dayLength);
            if (hours === null) {
                Main.notify("Non-24 Clock", "Could not read that day length, keeping the previous one. " +
                    "Use hours (24.5), h:mm (24:30 or 24:30.5) or h:mm:ss (24:39:35.244), " +
                    "at least 1 hour.");
            } else {
                this._appliedPeriod = hours;
                this._refresh();
            }
            return false;
        });
    },

    _initAnchor: function() {
        let period = this._periodHours();
        if (!this.anchorMs) {
            // First run: Non-24 midnight = local midnight today, day 1.
            this.anchorMs = localMidnightMs();
            this.anchorPos24 = 0;
            this.anchorDay = 1;
            this.anchorPeriod = period;
        } else if (!this.anchorPeriod) {
            // Settings from v0.1: anchor-ms was Non-24 midnight under the configured length.
            this.anchorPeriod = period;
        }
    },

    // Position since the anchor, unwrapped (0..24 per Non-24 day), under `period`.
    _unwrapped: function(nowMs, period) {
        return this.anchorPos24 + (nowMs - this.anchorMs) / HOUR_MS * (24 / period);
    },

    _samePeriod: function(a, b) {
        return Math.abs(a - b) < 1e-9;
    },

    // Changing the day length must not make the clock reading jump:
    //  - Wrap-around shows the hours since the last Non-24 midnight, so those stay as they
    //    are and only the point where the day wraps moves: with a longer day nothing changes,
    //    with a shorter one the reading wraps (and the day number advances) if the elapsed
    //    time no longer fits. The anchor is not touched, so changing the length back
    //    restores the old reading; _compute reads the anchor against the current length.
    //  - Mars-style shows the fraction of the day, so that fraction stays (the anchor is
    //    re-anchored at `nowMs` at the same position in the day, ClockMath.withPeriod).
    // Called before the anchor is used. A wrap -> Mars-style switch first folds a pending
    // wrap-around length change into the anchor, so the midnight does not move.
    _syncPeriod: function(nowMs) {
        let period = this._periodHours();
        let modeChanged = this._lastMode !== undefined && this._lastMode !== this.mode;
        if (modeChanged && this._lastMode === "wrap" && !this._samePeriod(period, this.anchorPeriod))
            this._reanchorWrap(nowMs, period);
        this._lastMode = this.mode;

        if (this.mode === "wrap" || this._samePeriod(period, this.anchorPeriod))
            return;
        let u = this._unwrapped(nowMs, this.anchorPeriod);
        let day = this.anchorDay + Math.floor(u / 24);
        this.anchorPos24 = wrap24(u);
        this.anchorDay = day;
        this.anchorMs = nowMs;
        this.anchorPeriod = period;
    },

    // Hours since the last Non-24 midnight at `nowMs`, in real hours, as wrap-around sees it
    // under day length `period`, and the days passed since the anchor's day began.
    // -> { shown, days }
    _wrapReading: function(nowMs, period) {
        let elapsed = this.anchorPos24 / 24 * this.anchorPeriod + (nowMs - this.anchorMs) / HOUR_MS;
        let days = Math.floor(elapsed / period);
        return { shown: elapsed - days * period, days: days };
    },

    // Re-anchor at `nowMs` under `period`, keeping the wrap-around reading and day number.
    _reanchorWrap: function(nowMs, period) {
        let r = this._wrapReading(nowMs, period);
        this.anchorPos24 = r.shown / period * 24;
        this.anchorDay = this.anchorDay + r.days;
        this.anchorMs = nowMs;
        this.anchorPeriod = period;
    },

    // Bring the anchor fully in line with the configured day length for the current mode, for
    // actions that re-anchor (set time, align seconds).
    _normalizeAnchor: function(nowMs) {
        this._syncPeriod(nowMs);
        let period = this._periodHours();
        if (this.mode === "wrap" && !this._samePeriod(period, this.anchorPeriod))
            this._reanchorWrap(nowMs, period);
    },

    // -> { text, day }
    _compute: function(nowMs) {
        this._syncPeriod(nowMs);
        let hours, day, shownLength;
        if (this.mode === "wrap") {
            shownLength = this._periodHours();
            let r = this._wrapReading(nowMs, shownLength);
            hours = r.shown;
            day = this.anchorDay + r.days;
        } else {
            shownLength = 24;
            let u = this._unwrapped(nowMs, this.anchorPeriod);
            hours = wrap24(u);
            day = this.anchorDay + Math.floor(u / 24);
        }
        let digits = hourDigitsFor(shownLength);
        return {
            text: this.showSeconds ? formatHms(hours, digits) : formatHm(hours, digits),
            day: day
        };
    },

    // ---- UI -------------------------------------------------------------------------

    _buildUi: function() {
        this._box = new St.BoxLayout({ vertical: true });
        // Unlit "ghost" segments: the same text with every segment on, drawn at 10 % opacity
        // exactly behind the clock text (DSEG digits all have the same width).
        this._ghostLabel = new St.Label({ opacity: 26 });
        this._timeLabel = new St.Label();
        this._clockStack = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            x_align: Clutter.ActorAlign.CENTER
        });
        this._clockStack.add_actor(this._ghostLabel);
        this._clockStack.add_actor(this._timeLabel);
        this._dayLabel = new St.Label({ x_align: Clutter.ActorAlign.CENTER });
        this._earthLabel = new St.Label({ x_align: Clutter.ActorAlign.CENTER });
        this._box.add_actor(this._clockStack);
        this._box.add_actor(this._dayLabel);
        this._box.add_actor(this._earthLabel);
        this.setContent(this._box);
    },

    // announce: the user just changed a setting (so a font problem is worth a notification)
    _restyleAndRefresh: function(announce) {
        this._applyStyle(!!announce);
        this._refresh();
    },

    // DSEG fonts only: do the digit-shape switches apply, and can this font draw them?
    _checkSegmentFont: function(font, announce) {
        this._segFont = /^DSEG(7|14)/i.test(font);
        this._seg14 = /^DSEG14/i.test(font);
        this._segOk = this._segFont;
        if (!this._segFont)
            return;
        let needsGlyphs = this.sevenThree || this.sixTailless || this.nineTailless ||
            (this._seg14 && !this.slashedZero);
        if (!needsGlyphs)
            return;
        this._segOk = fontHasSegmentGlyphs(font);
        if (!this._segOk) {
            global.logWarning("non24clock: font '" + font + "' has no Braille segment glyphs; digit shapes off");
            if (announce && this._warnedFont !== font) {
                this._warnedFont = font;
                Main.notify("Non-24 Clock", "The installed font \"" + font + "\" lacks the segment glyphs " +
                    "needed for the digit shapes (DSEG v0.50 or newer). Standard digits are shown.");
            }
        }
    },

    _shapeText: function(text) {
        if (!this._segFont || !this._segOk)
            return text;
        return segmentText(text, {
            is14: this._seg14,
            slashedZero: this.slashedZero,
            sixTailless: this.sixTailless,
            sevenThree: this.sevenThree,
            nineTailless: this.nineTailless
        });
    },

    _applyStyle: function(announce) {
        let font = ((this.customFont || "").trim() || this.fontFamily || "Monospace");
        font = font.replace(/['";{}\\]/g, "");
        this._checkSegmentFont(font, announce);
        let size = Math.max(12, Number(this.fontSize) || 56);
        let subSize = Math.max(10, Math.round(size * 0.28));
        let color = this.textColor || "rgba(120, 255, 160, 1)";
        let bg = this.bgColor || "rgba(0, 0, 0, 0.6)";
        let radius = Math.max(0, Number(this.cornerRadius) || 0);

        this._box.set_style("background-color: " + bg + "; border-radius: " + radius +
            "px; padding: 12px 20px;");
        let clockStyle = "font-family: '" + font + "'; font-size: " + size +
            "px; color: " + color + ";";
        this._timeLabel.set_style(clockStyle);
        this._ghostLabel.set_style(clockStyle);
        this._ghostLabel.visible = !!(this._segFont && this.showUnlit);
        this._dayLabel.set_style("font-size: " + subSize + "px; color: " + color + ";");

        // Earth time: own colour, with a small gap above it to set it apart from the clock.
        let earthColor = this.earthColor || "rgba(140, 180, 255, 1)";
        let gap = Math.round(subSize * 0.8);
        this._earthLabel.set_style("font-size: " + subSize + "px; color: " + earthColor +
            "; padding-top: " + gap + "px;");
    },

    _refresh: function() {
        let now = Date.now();
        let r = this._compute(now);

        // Besides set_text, ask for a relayout and repaint: after the text changed, the
        // leftmost digit has been seen staying stale until the pointer hovered the desklet.
        let clockText = this._shapeText(r.text);
        if (this._timeLabel.get_text() !== clockText) {
            this._timeLabel.set_text(clockText);
            this._timeLabel.queue_redraw();
        }

        // all segments on: '8' in DSEG7, '~' in DSEG14 (colon unchanged)
        let ghostText = r.text.replace(/\d/g, this._seg14 ? "~" : "8");
        if (this._ghostLabel.get_text() !== ghostText) {
            this._ghostLabel.set_text(ghostText);
            this._ghostLabel.queue_redraw();
            this._clockStack.queue_relayout();
        }

        let dayText = this.showDay ? "Day " + r.day : "";
        if (this._dayLabel.get_text() !== dayText)
            this._dayLabel.set_text(dayText);
        this._dayLabel.visible = !!dayText;

        let earthText = "";
        if (this.showReal) {
            let d = new Date(now);
            earthText = "Earth time " + utcLabel(d) + ": " + pad(d.getHours()) + ":" + pad(d.getMinutes());
        }
        if (this._earthLabel.get_text() !== earthText)
            this._earthLabel.set_text(earthText);
        this._earthLabel.visible = !!earthText;
    },

    // ---- set the time ---------------------------------------------------------------

    // Called by the "Set clock to this time now" button in the settings dialog.
    // The time is read in the units of the current display mode (ClockMath.fromShown).
    on_set_time_pressed: function() {
        let p = parseHMS(this.setTimeText);
        if (p === null) {
            Main.notify("Non-24 Clock", "Could not read that time. Use HH:MM or HH:MM:SS.");
            return;
        }

        let now = Date.now();
        if (!this._setShownHours(now, p / 3600, "That time"))
            return;

        // Wrap-around, HH:MM entered: HH:MM:00 becomes HH:MM:<real seconds> (shift 0..<60 s forward).
        let hasSeconds = /^\s*\d+:\d{1,2}:\d{1,2}\s*$/.test(this.setTimeText);
        if (this.mode === "wrap" && this.syncSeconds && !hasSeconds)
            this._alignSeconds(now, true);
        this._refresh();
    },

    // Called by the "Set clock to current local time" button: the clock reads the local
    // time of day (like the Earth clock), as far as that fits. In wrap-around mode that needs
    // the day length to be longer than the local time; Mars-style (0-24) always fits.
    // The seconds already agree with the Earth clock, so no seconds alignment is needed.
    on_set_local_time_pressed: function() {
        let now = Date.now();
        let d = new Date(now);
        let hours = d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600 +
            d.getMilliseconds() / HOUR_MS;
        if (!this._setShownHours(now, hours, "The current local time (" + pad(d.getHours()) + ":" +
                pad(d.getMinutes()) + ")"))
            return;
        this._refresh();
    },

    // Make the clock read `hours` (in the units of the current display mode: normal hours up
    // to the day length in wrap-around, 0-24 in Mars-style) as of `nowMs` (ClockMath.fromShown
    // and withPos24): re-anchor at "now", keeping the current day number. Returns false after
    // notifying, with nothing changed, if the time does not fit; `subject` names it there.
    _setShownHours: function(nowMs, hours, subject) {
        this._normalizeAnchor(nowMs);
        let period = this.anchorPeriod;
        let shownLength = this.mode === "wrap" ? period : 24;
        if (hours >= shownLength) {
            Main.notify("Non-24 Clock", this.mode === "wrap"
                ? subject + " is not shorter than the day length."
                : "Mars-style time must be below 24:00:00.");
            return false;
        }
        let day = this.anchorDay + Math.floor(this._unwrapped(nowMs, period) / 24);
        this.anchorPos24 = wrap24(hours / shownLength * 24);
        this.anchorDay = day;
        this.anchorMs = nowMs;
        return true;
    },

    // Re-anchor at `nowMs` so that, in wrap-around hours, the shown seconds equal the real
    // clock's seconds (ClockMath.alignedToRealSeconds). forwardOnly: shift 0..<60 s forward;
    // otherwise the nearest match, at most +-30 s. Keeps the day number.
    _alignSeconds: function(nowMs, forwardOnly) {
        const MINUTE_MS = 60000;
        this._normalizeAnchor(nowMs);
        let period = this.anchorPeriod;
        let u = this._unwrapped(nowMs, period);
        let day = this.anchorDay + Math.floor(u / 24);
        let shownMs = wrap24(u) / 24 * period * HOUR_MS;
        let shownPhase = ((shownMs % MINUTE_MS) + MINUTE_MS) % MINUTE_MS;
        let realPhase = ((nowMs % MINUTE_MS) + MINUTE_MS) % MINUTE_MS;
        let d = realPhase - shownPhase; // (-60 s, 60 s)
        if (forwardOnly) {
            if (d < 0)
                d += MINUTE_MS;
        } else {
            if (d >= MINUTE_MS / 2)
                d -= MINUTE_MS;
            else if (d < -MINUTE_MS / 2)
                d += MINUTE_MS;
        }
        let newShownHours = (shownMs + d) / HOUR_MS;
        this.anchorPos24 = wrap24(newShownHours / period * 24);
        this.anchorDay = day;
        this.anchorMs = nowMs;
    },

    // Called by the "align seconds" button in the settings dialog.
    on_align_seconds_pressed: function() {
        if (this.mode !== "wrap") {
            Main.notify("Non-24 Clock", "Seconds alignment only applies in wrap-around mode.");
            return;
        }
        this._alignSeconds(Date.now(), false);
        this._refresh();
    },

    on_desklet_removed: function() {
        if (this._timeoutId) {
            Mainloop.source_remove(this._timeoutId);
            this._timeoutId = 0;
        }
        if (this._lengthTimeoutId) {
            Mainloop.source_remove(this._lengthTimeoutId);
            this._lengthTimeoutId = 0;
        }
        this._cancelSync();
        if (this.settings)
            this.settings.finalize();
    }
};

function main(metadata, desklet_id) {
    return new Non24Desklet(metadata, desklet_id);
}
