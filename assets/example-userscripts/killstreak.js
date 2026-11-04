// ==UserScript==
// @name         Kill Streak
// @author       KRH
// @version      1.0.0
// @description  Shows a +N pop-up for every kill in a row (a nuke at 25, 50, 75...) and resets when you die or the game changes
// @run-at       document-end
// ==/UserScript==

// shipped with KRH Client as an example userscript. It reads Krunker's own kill feed (#chatList), so nothing is injected into the game.
// `this.unload` is called when the script is switched off live: it stops the observer and timers and removes the pop-up.
const __kcSelf = this;

(function () {
    'use strict';

    if (window.__kcKillStreakLoaded) return;
    window.__kcKillStreakLoaded = true;

    /* ---------------- CONFIG ---------------- */
    const CONFIG = {
        yourName: 'You',          // how you appear in the kill feed
        popupTopPercent: 60,      // vertical position of the +N pop-up (% of screen height)
        fontSize: 46,             // px
        durationMs: 1400,         // how long the pop-up stays
        nukeAt: 25,               // streak at which the pop-up turns into a nuke emoji
        showStreakBadge: true,    // small "Streak: N" label that stays while a streak is active
        debug: false              // console logs, handy if the feed isn't detected
    };

    const ICON_SELECTOR = 'img, svg, [class*="icon" i], [class*="weapon" i]';

    /* ---------------- STATE ---------------- */
    let streak = 0;
    let gameKey = null;
    let observedList = null;
    let observer = null;
    const timers = [];
    const listeners = [];
    const seen = new WeakSet();

    const log = (...a) => CONFIG.debug && console.log('[KillStreak]', ...a);

    /* ---------------- UI ---------------- */
    function injectStyle() {
        if (document.getElementById('kcs-style')) return;
        const s = document.createElement('style');
        s.id = 'kcs-style';
        s.textContent = `
        #kcs-popup, #kcs-badge {
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
            color: #fff;
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
        /* only visible while you are actually playing (mouse captured) */
        body:not(.kcs-ingame) #kcs-popup,
        body:not(.kcs-ingame) #kcs-badge { display: none !important; }
        `;
        (document.head || document.documentElement).appendChild(s);
    }

    function ensureElements() {
        injectStyle();
        let popup = document.getElementById('kcs-popup');
        if (!popup) {
            popup = document.createElement('div');
            popup.id = 'kcs-popup';
            (document.body || document.documentElement).appendChild(popup);
        }
        let badge = document.getElementById('kcs-badge');
        if (!badge) {
            badge = document.createElement('div');
            badge.id = 'kcs-badge';
            (document.body || document.documentElement).appendChild(badge);
        }
        return { popup, badge };
    }

    function showPopup(n) {
        const { popup, badge } = ensureElements();
        // white "+N" always; every nukeAt kills (25, 50, 75...) it becomes a nuke emoji
        popup.textContent = (n % CONFIG.nukeAt === 0) ? '\u2622\uFE0F' : '+' + n;
        popup.style.color = '#ffffff';
        popup.classList.remove('kcs-pop');
        void popup.offsetWidth; // restart animation
        popup.classList.add('kcs-pop');
        if (CONFIG.showStreakBadge) {
            badge.textContent = 'Streak: ' + n;
            badge.classList.add('kcs-on');
        }
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

    /* ---------------- KILL FEED PARSING ---------------- */
    const clean = (t) =>
        (t || '')
            .replace(/[\u{1F300}-\u{1FAFF}\u2600-\u27BF]/gu, '')
            .replace(/\s+/g, ' ')
            .trim();

    const DEATH_WORDS = /\b(fell|fall|died|die|dead|death|drown|suicide|void|bounds|killed yourself)/i;
    const pendingTries = new WeakMap();
    const SUICIDE_RE = new RegExp('^' + CONFIG.yourName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' committed\\b', 'i');

    function evaluateRow(row) {
        if (!row || seen.has(row) || row.nodeType !== 1) return;

        const full = clean(row.textContent);
        if (!full) return;
        // normal chat messages look like "name: message" - ignore them
        if (full.includes(':')) return;

        const me = CONFIG.yourName;

        const icons = row.querySelectorAll(ICON_SELECTOR);
        if (!icons.length) {
            // Plain-text death messages (fall / void / self-inflicted), e.g. "You fell ..."
            // Krunker's suicide messages are all "You committed <something>" (alt F4, death.exe...)
            if (full === me || SUICIDE_RE.test(full) || (full.startsWith(me + ' ') && DEATH_WORDS.test(full))) {
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

        // Icon rows with only YOU and no other name: self-inflicted deaths
        // ("You [icon]" or "[icon] You"), such as falling off the map.
        if ((killer === me && !victim) || (!killer && victim === me)) {
            // The row might still be being built (victim name not added yet), so look again
            // a couple of times before treating it as a death.
            const tries = (pendingTries.get(row) || 0) + 1;
            pendingTries.set(row, tries);
            if (tries < 3) {
                setTimeout(() => evaluateRow(row), 150);
                return;
            }
            seen.add(row);
            resetStreak('died (no killer)');
            return;
        }

        if (!killer || !victim) return;

        if (victim === me) {
            // you died (includes suicides)
            seen.add(row);
            resetStreak('died');
        } else if (killer === me) {
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

    function init() {
        ensureElements();
        updateVisibility();
        document.addEventListener('pointerlockchange', updateVisibility);
        listeners.push([document, 'pointerlockchange', updateVisibility]);
        timers.push(setInterval(updateVisibility, 500));
        gameKey = currentGameKey();
        watchChatList();
        timers.push(setInterval(() => {
            watchChatList(); // re-attach if Krunker rebuilds the chat list
            checkGameChange();
        }, 1000));
        const onUrl = () => resetStreak('url change');
        window.addEventListener('hashchange', onUrl);
        window.addEventListener('popstate', onUrl);
        listeners.push([window, 'hashchange', onUrl], [window, 'popstate', onUrl]);
        // manual access from the dev console: kcStreak.reset(), kcStreak.get()
        window.kcStreak = { reset: () => resetStreak('manual'), get: () => streak };
    }

    // called by the client when the script is switched off: undo everything init() set up
    __kcSelf.unload = function () {
        timers.forEach(clearInterval);
        listeners.forEach(([t, e, f]) => t.removeEventListener(e, f));
        if (observer) observer.disconnect();
        observer = null;
        observedList = null;
        streak = 0;
        ['kcs-popup', 'kcs-badge', 'kcs-style'].forEach((id) => { const el = document.getElementById(id); if (el) el.remove(); });
        if (document.body) document.body.classList.remove('kcs-ingame');
        delete window.kcStreak;
        window.__kcKillStreakLoaded = false;
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();

// the client keeps `this.unload` only when the script returns `this`
return this;
