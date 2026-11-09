// ==UserScript==
// @name         Kill Streak
// @author       KRH
// @version      1.1.0
// @description  Shows a +N pop-up for every kill in a row (a nuke at 25, 50, 75...) and resets when you die or the game changes. Needs the kill feed shown in the chat (Krunker settings)
// @run-at       document-end
// ==/UserScript==

// `this` is the script context the client hands over (settings / unload live there); inside the IIFE it would be lost
const kcHost = this;

(function () {
    'use strict';

    if (window.__kcKillStreakLoaded) return;
    window.__kcKillStreakLoaded = true;

    /* ---------------- CONFIG ---------------- */
    // Defaults. Every value below is also a setting in Settings > Userscripts (see the end of this file).
    const CONFIG = {
        popupTopPercent: 60,      // vertical position of the +N pop-up (% of screen height)
        fontSize: 46,             // px
        durationMs: 1400,         // how long the pop-up stays
        nukeAt: 25,               // streak at which the pop-up turns into a nuke emoji
        nukeEmoji: '\u2622\uFE0F',
        popupColor: '#ffffff',
        showStreakBadge: true,    // small "Streak: N" label that stays while a streak is active
        sound: false,             // short blip per kill, higher with the streak
        soundVolume: 30,          // 0-100
        warnNoFeed: true,         // one-time hint if the chat never shows a kill feed row
        debug: false              // console logs, handy if the feed isn't detected
    };

    const ICON_SELECTOR = 'img, svg, [class*="icon" i], [class*="weapon" i]';
    const NO_FEED_AFTER_S = 120;  // seconds of live play without a single kill feed row before the hint shows

    /* ---------------- STATE ---------------- */
    let streak = 0;
    let gameKey = null;
    let observedList = null;
    let observer = null;
    let seen = new WeakSet();
    let feedRowsSeen = 0;         // rows with an icon that reached evaluateRow (= the kill feed is in the chat)
    let liveSeconds = 0;          // seconds spent with the mouse captured
    let warned = false;
    let audioCtx = null;
    let stopped = false;
    const timers = [];
    const listeners = [];

    const log = (...a) => CONFIG.debug && console.log('[KillStreak]', ...a);

    /* ---------------- WHO AM I ---------------- */
    // How the player appears in the kill feed: "You" in Krunker's own feed, the account name elsewhere.
    // Read on every row so switching account (alt manager) needs no reload. Lower-cased for comparing.
    function myNames() {
        const names = ['you'];
        try {
            const n = (window.localStorage.getItem('krunker_username') || '').trim().toLowerCase();
            if (n && !names.includes(n)) names.push(n);
        } catch (e) { /* storage blocked */ }
        return names;
    }
    const isMe = (text) => myNames().includes((text || '').toLowerCase());
    const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    /* ---------------- UI ---------------- */
    function styleText() {
        return `
        #kcs-popup, #kcs-badge, #kcs-toast {
            position: fixed;
            left: 50%;
            transform: translateX(-50%);
            pointer-events: none;
            z-index: 2147483647;
            font-family: GameFont, gamefont, 'Titillium Web', sans-serif;
            text-shadow: 2px 2px 0 rgba(0,0,0,.65), 0 0 8px rgba(0,0,0,.5);
            user-select: none;
            white-space: nowrap;
        }
        #kcs-popup {
            top: ${CONFIG.popupTopPercent}%;
            font-size: ${CONFIG.fontSize}px;
            color: ${CONFIG.popupColor};
            opacity: 0;
        }
        #kcs-popup.kcs-pop {
            animation: kcs-pop ${CONFIG.durationMs}ms ease-out forwards;
        }
        @keyframes kcs-pop {
            0%   { opacity: 0; transform: translate(-50%, 12px) scale(.6); }
            12%  { opacity: 1; transform: translate(-50%, 0) scale(1.25); }
            25%  { opacity: 1; transform: translate(-50%, 0) scale(1); }
            75%  { opacity: 1; transform: translate(-50%, -8px) scale(1); }
            100% { opacity: 0; transform: translate(-50%, -34px) scale(1); }
        }
        #kcs-badge {
            top: calc(${CONFIG.popupTopPercent}% + ${CONFIG.fontSize + 14}px);
            font-size: 20px;
            color: #ffe44d;
            opacity: 0;
            transition: opacity .2s;
        }
        #kcs-badge.kcs-on { opacity: .9; }
        #kcs-toast {
            top: 12%;
            font-size: 18px;
            color: #fff;
            background: rgba(0,0,0,.72);
            padding: 10px 18px;
            border-radius: 8px;
            opacity: 0;
            transition: opacity .3s;
        }
        #kcs-toast.kcs-on { opacity: 1; }
        /* only visible while you are actually playing (mouse captured) */
        body:not(.kcs-ingame) #kcs-popup,
        body:not(.kcs-ingame) #kcs-badge { display: none !important; }
        `;
    }

    // Create or refresh the stylesheet; safe to call again whenever a setting changes
    function applyStyle() {
        const parent = document.head || document.documentElement;
        if (!parent) return;
        let s = document.getElementById('kcs-style');
        if (!s) {
            s = document.createElement('style');
            s.id = 'kcs-style';
            parent.appendChild(s);
        }
        s.textContent = styleText();
    }

    function ensureElements() {
        applyStyle();
        const host = document.body || document.documentElement;
        const make = (id) => {
            let el = document.getElementById(id);
            if (!el) {
                el = document.createElement('div');
                el.id = id;
                host.appendChild(el);
            }
            return el;
        };
        return { popup: make('kcs-popup'), badge: make('kcs-badge') };
    }

    function beep(n) {
        if (!CONFIG.sound || CONFIG.soundVolume <= 0) return;
        try {
            const Ctx = window.AudioContext || window.webkitAudioContext;
            if (!Ctx) return;
            if (!audioCtx) audioCtx = new Ctx();
            if (audioCtx.state === 'suspended') audioCtx.resume();
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            const now = audioCtx.currentTime;
            // a little higher with every kill, capped at two octaves above the base note
            osc.frequency.value = 520 * Math.pow(2, Math.min(24, n - 1) / 12);
            osc.type = 'triangle';
            gain.gain.setValueAtTime(0.0001, now);
            gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, CONFIG.soundVolume / 100 * 0.25), now + 0.01);
            gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
            osc.connect(gain).connect(audioCtx.destination);
            osc.start(now);
            osc.stop(now + 0.18);
        } catch (e) { /* audio blocked, not worth a message */ }
    }

    function showPopup(n) {
        const { popup, badge } = ensureElements();
        // plain "+N"; every nukeAt kills (25, 50, 75...) it becomes the nuke emoji
        popup.textContent = (CONFIG.nukeAt > 0 && n % CONFIG.nukeAt === 0) ? CONFIG.nukeEmoji : '+' + n;
        popup.classList.remove('kcs-pop');
        void popup.offsetWidth; // restart animation
        popup.classList.add('kcs-pop');
        if (CONFIG.showStreakBadge) {
            badge.textContent = 'Streak: ' + n;
            badge.classList.add('kcs-on');
        }
        beep(n);
    }

    function resetStreak(reason) {
        if (streak !== 0) log('reset:', reason);
        streak = 0;
        const popup = document.getElementById('kcs-popup');
        const badge = document.getElementById('kcs-badge');
        if (popup) popup.classList.remove('kcs-pop');
        if (badge) badge.classList.remove('kcs-on');
    }

    function addKill() {
        streak++;
        log('kill! streak =', streak);
        showPopup(streak);
    }

    // One-time hint: the whole script reads the kill feed from the chat list, so with the feed switched off it sees nothing
    function showNoFeedHint() {
        warned = true;
        const host = document.body || document.documentElement;
        if (!host) return;
        ensureElements();
        let toast = document.getElementById('kcs-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'kcs-toast';
            host.appendChild(toast);
        }
        toast.textContent = 'Kill Streak sees no kill feed. Turn on the kill feed in the chat (Krunker settings).';
        void toast.offsetWidth;
        toast.classList.add('kcs-on');
        timers.push(setTimeout(() => toast.classList.remove('kcs-on'), 9000));
        console.warn('[KillStreak] no kill feed rows in #chatList after ' + NO_FEED_AFTER_S + 's of play: switch the kill feed on in the chat settings.');
    }

    /* ---------------- KILL FEED PARSING ---------------- */
    const clean = (t) =>
        (t || '')
            .replace(/[\u{1F300}-\u{1FAFF}\u2600-\u27BF]/gu, '')
            .replace(/\s+/g, ' ')
            .trim();

    const DEATH_WORDS = /\b(fell|fall|died|die|dead|death|drown|suicide|void|bounds|killed yourself)/i;
    const pendingTries = new WeakMap();

    // Krunker's suicide messages are all "<you> committed <something>" (alt F4, death.exe...)
    function isSuicideText(full) {
        return myNames().some((n) => new RegExp('^' + escapeRe(n) + ' committed\\b', 'i').test(full));
    }

    function startsWithMe(full) {
        const low = full.toLowerCase();
        return myNames().some((n) => low.startsWith(n + ' '));
    }

    function evaluateRow(row) {
        if (stopped || !row || seen.has(row) || row.nodeType !== 1) return;

        const full = clean(row.textContent);
        if (!full) return;
        // normal chat messages look like "name: message" - ignore them
        if (full.includes(':')) return;

        const icons = row.querySelectorAll(ICON_SELECTOR);
        if (!icons.length) {
            // Plain-text death messages (fall / void / self-inflicted), e.g. "You fell ..."
            if (isMe(full) || isSuicideText(full) || (startsWithMe(full) && DEATH_WORDS.test(full))) {
                log('plain-text death row:', full);
                seen.add(row);
                resetStreak('died (environment)');
            }
            return; // everything else without an icon is not a kill feed row
        }

        const first = icons[0];
        const last = icons[icons.length - 1];

        const r1 = document.createRange();
        r1.setStart(row, 0);
        r1.setEndBefore(first);
        const killer = clean(r1.toString());

        const r2 = document.createRange();
        r2.setStartAfter(last);
        r2.setEnd(row, row.childNodes.length);
        const victim = clean(r2.toString());

        log('feed row:', JSON.stringify(killer), '->', JSON.stringify(victim));
        feedRowsSeen++;

        // Icon rows with only YOU and no other name: self-inflicted deaths
        // ("You [icon]" or "[icon] You"), such as falling off the map.
        if ((isMe(killer) && !victim) || (!killer && isMe(victim))) {
            // The row might still be being built (victim name not added yet), so look again
            // a couple of times before treating it as a death.
            const tries = (pendingTries.get(row) || 0) + 1;
            pendingTries.set(row, tries);
            if (tries < 3) {
                timers.push(setTimeout(() => evaluateRow(row), 150));
                return;
            }
            seen.add(row);
            resetStreak('died (no killer)');
            return;
        }

        if (!killer || !victim) return;

        if (isMe(victim)) {
            // you died (includes suicides)
            seen.add(row);
            resetStreak('died');
        } else if (isMe(killer)) {
            // "You [weapon] Enemy"
            seen.add(row);
            addKill();
        } else {
            // someone else's kill - not ours, never needs re-checking
            seen.add(row);
        }
    }

    function rowOf(node, list) {
        let n = node.nodeType === 1 ? node : node.parentElement;
        while (n && n.parentElement !== list) n = n.parentElement;
        return n;
    }

    function attach(list) {
        if (observer) observer.disconnect();
        observedList = list;
        // mark everything already in the feed as seen so old kills aren't counted
        Array.from(list.children).forEach((c) => seen.add(c));

        const pending = new Set();
        let scheduled = false;
        const flush = () => {
            scheduled = false;
            pending.forEach(evaluateRow);
            pending.clear();
        };

        observer = new MutationObserver((muts) => {
            for (const m of muts) {
                const targets = m.type === 'childList' ? m.addedNodes : [m.target];
                for (const node of targets) {
                    const row = rowOf(node, list);
                    if (row) pending.add(row);
                }
            }
            if (pending.size && !scheduled) {
                scheduled = true;
                requestAnimationFrame(flush); // wait until the row is fully built
            }
        });
        observer.observe(list, { childList: true, subtree: true, characterData: true });
        log('attached to #chatList');
    }

    function watchChatList() {
        const list = document.getElementById('chatList');
        if (list && list !== observedList) attach(list);
    }

    /* ---------------- GAME / MAP CHANGE DETECTION ---------------- */
    function currentGameKey() {
        let key = location.href;
        try {
            if (typeof window.getGameActivity === 'function') {
                const a = window.getGameActivity() || {};
                key += '|' + [a.id, a.map, a.mode, a.custom].join('|');
            }
        } catch (e) { /* ignore */ }
        return key;
    }

    function checkGameChange() {
        const key = currentGameKey();
        if (gameKey !== null && key !== gameKey) resetStreak('new game / map');
        gameKey = key;
    }

    /* ---------------- START ---------------- */
    // Krunker captures the mouse (pointer lock) only during live gameplay.
    // Menus, settings, map voting, end-of-round screens all release it.
    function updateVisibility() {
        if (!document.body) return;
        document.body.classList.toggle('kcs-ingame', !!document.pointerLockElement);
    }

    function on(target, type, fn) {
        target.addEventListener(type, fn);
        listeners.push([target, type, fn]);
    }

    function init() {
        if (stopped) return;
        ensureElements();
        updateVisibility();
        on(document, 'pointerlockchange', updateVisibility);
        timers.push(setInterval(updateVisibility, 500));
        gameKey = currentGameKey();
        watchChatList();
        timers.push(setInterval(() => {
            watchChatList(); // re-attach if Krunker rebuilds the chat list
            checkGameChange();
        }, 1000));
        // live-play clock for the "no kill feed" hint
        timers.push(setInterval(() => {
            if (!document.pointerLockElement) return;
            liveSeconds++;
            if (CONFIG.warnNoFeed && !warned && feedRowsSeen === 0 && liveSeconds >= NO_FEED_AFTER_S) showNoFeedHint();
        }, 1000));
        on(window, 'hashchange', () => resetStreak('url change'));
        on(window, 'popstate', () => resetStreak('url change'));
        // manual access from the dev console: kcStreak.reset(), kcStreak.get()
        window.kcStreak = { reset: () => resetStreak('manual'), get: () => streak };
    }

    // Called when the script is switched off from the dashboard: undo everything, so it can be started again cleanly
    function stop() {
        stopped = true;
        if (observer) observer.disconnect();
        observer = null;
        observedList = null;
        timers.forEach((t) => { clearTimeout(t); clearInterval(t); });
        timers.length = 0;
        listeners.forEach(([t, type, fn]) => t.removeEventListener(type, fn));
        listeners.length = 0;
        ['kcs-popup', 'kcs-badge', 'kcs-toast', 'kcs-style'].forEach((id) => document.getElementById(id)?.remove());
        if (document.body) document.body.classList.remove('kcs-ingame');
        if (audioCtx) { try { audioCtx.close(); } catch (e) { /* already closed */ } audioCtx = null; }
        delete window.kcStreak;
        delete window.__kcKillStreakLoaded;
    }

    /* ---------------- SETTINGS (Settings > Userscripts) ---------------- */
    const num = (v, lo, hi, fallback) => {
        const n = Number(v);
        return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
    };
    const restyle = () => { if (!stopped) applyStyle(); };
    const NUKE_EMOJIS = ['\u2622\uFE0F', '\uD83D\uDCA5', '\uD83D\uDE80', '\u2604\uFE0F', '\uD83D\uDD25'];

    if (kcHost) {
        kcHost.settings = {
            popupTop: {
                title: 'Pop-up position',
                desc: 'Vertical position of the +N pop-up, in % of the screen height (0 = top)',
                type: 'num', value: CONFIG.popupTopPercent, min: 0, max: 95, step: 1,
                changed(v) { CONFIG.popupTopPercent = num(v, 0, 95, 60); restyle(); },
            },
            fontSize: {
                title: 'Pop-up size',
                desc: 'Text size of the +N pop-up in px',
                type: 'num', value: CONFIG.fontSize, min: 12, max: 160, step: 2,
                changed(v) { CONFIG.fontSize = num(v, 12, 160, 46); restyle(); },
            },
            popupColor: {
                title: 'Pop-up colour',
                type: 'color', value: CONFIG.popupColor,
                changed(v) { CONFIG.popupColor = typeof v === 'string' && v ? v : '#ffffff'; restyle(); },
            },
            duration: {
                title: 'Pop-up time',
                desc: 'How long the pop-up stays, in milliseconds',
                type: 'num', value: CONFIG.durationMs, min: 400, max: 5000, step: 100,
                changed(v) { CONFIG.durationMs = num(v, 400, 5000, 1400); restyle(); },
            },
            nukeAt: {
                title: 'Nuke every',
                desc: 'Every this many kills in a row the pop-up becomes the nuke icon. 0 turns it off',
                type: 'num', value: CONFIG.nukeAt, min: 0, max: 1000, step: 1,
                changed(v) { CONFIG.nukeAt = Math.floor(num(v, 0, 1000, 25)); },
            },
            nukeEmoji: {
                title: 'Nuke icon',
                type: 'sel', value: CONFIG.nukeEmoji, opts: NUKE_EMOJIS,
                changed(v) { CONFIG.nukeEmoji = NUKE_EMOJIS.includes(v) ? v : NUKE_EMOJIS[0]; },
            },
            badge: {
                title: 'Streak label',
                desc: 'Keep a small "Streak: N" label under the pop-up while a streak is running',
                type: 'bool', value: CONFIG.showStreakBadge,
                changed(v) {
                    CONFIG.showStreakBadge = !!v;
                    if (!v) document.getElementById('kcs-badge')?.classList.remove('kcs-on');
                },
            },
            sound: {
                title: 'Sound',
                desc: 'A short blip on every kill, a bit higher with each kill in the streak',
                type: 'bool', value: CONFIG.sound,
                changed(v) { CONFIG.sound = !!v; },
            },
            soundVolume: {
                title: 'Sound volume',
                type: 'num', value: CONFIG.soundVolume, min: 0, max: 100, step: 5,
                changed(v) { CONFIG.soundVolume = num(v, 0, 100, 30); },
            },
            warnNoFeed: {
                title: 'Hint when no kill feed',
                desc: 'Show a one-time hint if no kill feed shows up in the chat after two minutes of play. Kill Streak reads the kill feed from the chat, so it must be switched on in Krunker\'s settings',
                type: 'bool', value: CONFIG.warnNoFeed,
                changed(v) { CONFIG.warnNoFeed = !!v; },
            },
            debug: {
                title: 'Debug log',
                desc: 'Write every kill feed row it reads to the console (F12)',
                type: 'bool', value: CONFIG.debug,
                changed(v) { CONFIG.debug = !!v; },
            },
        };
        kcHost.unload = stop;
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
