/**
 * Tooltips for the dashboard.
 *
 * Every hint on these pages is written as a plain `title`, so it still says
 * something useful if this file never loads - that is the fallback. When it
 * does load, each title is moved to `data-tip` and shown in a small panel of
 * our own: it appears straight away instead of after a second, it is styled
 * like the rest of the page, and it is not clipped by a scrolling panel the
 * way a CSS-only tooltip would be.
 */
(() => {
    const DELAY = 320;      // long enough that sweeping the mouse across stays quiet
    const GAP = 10;         // between the tooltip and whatever it belongs to
    const EDGE = 8;         // keep it off the edge of the window

    let panel = null;
    let timer = null;
    let current = null;

    // Something that has just been clicked. A <select> opens its list right
    // where the tooltip sits, so the tooltip would be explaining a menu it is
    // hiding behind. Nothing shows for this element again until the pointer
    // has moved somewhere else.
    let busy = null;

    document.head.insertAdjacentHTML('beforeend', `<style>
    .qtip {
        position: fixed; z-index: 9999; top: 0; left: 0;
        max-width: 280px; padding: 7px 10px;
        background: #16161f; color: #f2f2f7;
        border: 1px solid rgba(255, 255, 255, .12); border-radius: 8px;
        box-shadow: 0 10px 30px rgba(0, 0, 0, .45);
        font-family: inherit; font-size: 12.5px; line-height: 1.45; font-weight: 400;
        text-align: left; white-space: normal;
        pointer-events: none;
        opacity: 0; transform: translateY(3px);
        transition: opacity .12s ease, transform .12s ease;
    }
    .qtip.show { opacity: 1; transform: none; }

    /* The little arrow, pointed at whatever is being explained. */
    .qtip::after {
        content: ''; position: absolute; left: var(--arrow, 50%); margin-left: -5px;
        border: 5px solid transparent;
    }
    .qtip:not(.below)::after { top: 100%; border-top-color: #16161f; }
    .qtip.below::after { bottom: 100%; border-bottom-color: #16161f; }

    @media (prefers-reduced-motion: reduce) {
        .qtip { transition: none; }
    }
    </style>`);

    function ensurePanel() {
        if (!panel) {
            panel = document.createElement('div');
            panel.className = 'qtip';
            panel.setAttribute('role', 'tooltip');
            document.body.appendChild(panel);
        }
        return panel;
    }

    /** Moves a native `title` out of the way so only our own tooltip shows. */
    function upgrade(node) {
        if (!(node instanceof Element)) return;

        const targets = node.hasAttribute('title') ? [node] : [];
        targets.push(...node.querySelectorAll('[title]'));

        for (const element of targets) {
            const text = element.getAttribute('title');
            element.removeAttribute('title');

            // Clearing a title is how the pages take a hint away again, so an
            // empty one has to take the tooltip with it.
            if (text) element.setAttribute('data-tip', text);
            else element.removeAttribute('data-tip');
        }
    }

    function place(target) {
        const tip = ensurePanel();
        tip.textContent = target.getAttribute('data-tip') || '';
        tip.classList.add('show');

        const anchor = target.getBoundingClientRect();
        const own = tip.getBoundingClientRect();

        const wanted = anchor.left + anchor.width / 2 - own.width / 2;
        const left = Math.max(EDGE, Math.min(wanted, window.innerWidth - own.width - EDGE));

        // Above by preference; below when there is no room up there.
        const below = anchor.top - own.height - GAP < EDGE;
        const top = below ? anchor.bottom + GAP : anchor.top - own.height - GAP;

        tip.classList.toggle('below', below);
        tip.style.left = `${Math.round(left)}px`;
        tip.style.top = `${Math.round(top)}px`;

        // Nudged so the arrow still points at the middle of the target even
        // when the tooltip had to slide along to fit on screen.
        const arrow = anchor.left + anchor.width / 2 - left;
        tip.style.setProperty('--arrow', `${Math.max(10, Math.min(arrow, own.width - 10))}px`);
    }

    function show(target) {
        if (target === current || target === busy) return;

        hide();
        current = target;
        timer = setTimeout(() => place(target), DELAY);
    }

    function hide() {
        clearTimeout(timer);
        current = null;
        if (panel) panel.classList.remove('show');
    }

    document.addEventListener('mouseover', event => {
        const target = event.target.closest?.('[data-tip]');

        // Moving off whatever was clicked lets it speak up again.
        if (busy && busy !== target) busy = null;

        if (target) show(target);
        else if (current) hide();
    });

    document.addEventListener('focusin', event => {
        const target = event.target.closest?.('[data-tip]');
        if (target) show(target);
    });

    document.addEventListener('focusout', hide);

    document.addEventListener('mousedown', event => {
        busy = event.target.closest?.('[data-tip]') || null;
        hide();
    });
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape') return hide();

        // A dropdown can be opened from the keyboard too, and it lands on top
        // of the tooltip just the same.
        if (event.target instanceof HTMLSelectElement) {
            busy = event.target.closest('[data-tip]');
            hide();
        }
    });
    window.addEventListener('scroll', hide, true);
    window.addEventListener('blur', hide);

    // The property panel and the admin pages build their controls as you go,
    // so new titles have to be picked up as they arrive.
    const watcher = new MutationObserver(records => {
        for (const record of records) {
            if (record.type === 'attributes') upgrade(record.target);
            else record.addedNodes.forEach(upgrade);
        }
    });

    function start() {
        upgrade(document.body);
        watcher.observe(document.body, {
            subtree: true,
            childList: true,
            attributes: true,
            attributeFilter: ['title']
        });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})();
