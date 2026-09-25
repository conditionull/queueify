/*
 * Light or dark, the same way the docs site does it: follow the system until
 * somebody picks one, then remember what they picked.
 *
 * Loaded in <head> without defer on purpose. The class has to be on <html>
 * before the first paint, or a light-mode user sees a flash of dark on every
 * page load - and this dashboard reloads on every page change.
 */
(function () {
    const KEY = 'queueify-color-mode';
    const root = document.documentElement;
    const system = window.matchMedia('(prefers-color-scheme: light)');

    function stored() {
        try { return localStorage.getItem(KEY); } catch { return null; }
    }

    function apply(mode) {
        root.classList.toggle('light', mode === 'light');
        root.classList.toggle('dark', mode !== 'light');
    }

    apply(stored() || (system.matches ? 'light' : 'dark'));

    // Only while nothing has been chosen: a choice outranks the system.
    system.addEventListener('change', event => {
        if (!stored()) apply(event.matches ? 'light' : 'dark');
    });

    function toggle() {
        const next = root.classList.contains('light') ? 'dark' : 'light';
        apply(next);
        try { localStorage.setItem(KEY, next); } catch { /* private window: this page only */ }
    }

    document.addEventListener('click', event => {
        if (event.target.closest('[data-color-mode-toggle]')) toggle();
    });
})();

/*
 * The header and the sidebar, written once for every page.
 *
 * They are custom elements defined here, in <head>, before the body is parsed.
 * An element whose definition already exists is built the moment the parser
 * reaches it, so both are in the DOM before the first paint and before any
 * page script runs - the dashboard's own script finds #nav-twitch and
 * #dot-twitch exactly as if they had been typed into the page.
 */
(function () {
    const DOCS = 'https://queueify-docs.vercel.app';
    const GITHUB = 'https://github.com/conditionull/queueify';

    // Lucide, as the docs site uses, copied out of node_modules/lucide-static.
    const ICONS = {
        rocket: '<path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09"/><path d="M9 12a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.4 22.4 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 .05 5 .05"/>',
        bot: '<path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/>',
        palette: '<path d="M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z"/><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/>',
        settings: '<path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"/><circle cx="12" cy="12" r="3"/>',
        terminal: '<path d="M12 19h8"/><path d="m4 17 6-6-6-6"/>',
        chart: '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="m19 9-5 5-4-4-3 3"/>',
        sparkles: '<path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"/><path d="M20 2v4"/><path d="M22 4h-4"/><circle cx="4" cy="20" r="2"/>',
        book: '<path d="M12 5v16"/><path d="M20.001 19A2 2 0 0 0 22 17V5a2 2 0 0 0-1.999-2L16 3.002A5 5 0 0 0 12 5a5 5 0 0 0-4-2H4a2 2 0 0 0-2 2v12a2 2 0 0 0 1.999 2H8a5 5 0 0 1 4 2 5 5 0 0 1 4-2z"/>',
        moon: '<path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401"/>',
        sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>'
    };

    // Lucide dropped brand logos, so GitHub's comes from Simple Icons like the
    // docs site's does. It is a filled shape, not a stroked one.
    const GITHUB_MARK = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>';

    const icon = name => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
        'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[name] + '</svg>';

    // `page` is where the item lives when you are not on the dashboard: the
    // tools go straight to themselves rather than to their card on the
    // dashboard that only says "open the tool".
    const GROUPS = [
        {
            title: 'Setup', icon: 'rocket', items: [
                { view: 'twitch', name: 'Twitch', step: 1 },
                { view: 'spotify', name: 'Spotify', step: 2 },
                { view: 'reward', name: 'Channel points', step: 3, optional: true },
                { view: 'obs', name: 'OBS', step: 4, optional: true },
                { view: 'canvas', name: 'Canvas videos', step: 5, optional: true }
            ]
        },
        {
            title: 'Your bot', icon: 'bot', items: [
                { view: 'themes', name: 'Widget themes', icon: 'palette', page: '/editor.html' },
                { view: 'admin', name: 'Admin panel', icon: 'settings', page: '/admin.html' },
                { view: 'commands', name: 'Chat commands', icon: 'terminal' },
                { view: 'stats', name: 'Stats', icon: 'chart', page: '/stats.html' },
                { view: 'changelog', name: "What's new", icon: 'sparkles' }
            ]
        }
    ];

    customElements.define('q-header', class extends HTMLElement {
        connectedCallback() {
            if (this.firstChild) return;
            this.innerHTML =
                '<header class="d-header">' +
                  '<a class="d-wordmark" href="/" aria-label="Queueify dashboard">queueify</a>' +
                  '<span class="d-version" id="brand-version"></span>' +
                  '<div class="d-spacer"></div>' +
                  '<a class="d-icon-btn with-label" href="' + DOCS + '" target="_blank" rel="noopener noreferrer" title="The Queueify documentation">' +
                    icon('book') + '<span class="d-hide-narrow">Docs</span></a>' +
                  '<button type="button" class="d-icon-btn d-mode" data-color-mode-toggle title="Switch between light and dark" aria-label="Switch between light and dark">' +
                    '<span class="moon">' + icon('moon') + '</span><span class="sun">' + icon('sun') + '</span></button>' +
                  '<a class="d-icon-btn" href="' + GITHUB + '" target="_blank" rel="noopener noreferrer" title="Queueify on GitHub" aria-label="Queueify on GitHub">' +
                    GITHUB_MARK + '</a>' +
                '</header>';
        }
    });

    /*
     * On the dashboard (`views`), every item is a button the page script wires
     * up to switch sections, carrying the ids it looks for. Anywhere else they
     * are plain links, and `active` marks the page you are on.
     */
    customElements.define('q-nav', class extends HTMLElement {
        connectedCallback() {
            if (this.firstChild) return;
            const views = this.hasAttribute('views');
            const active = this.getAttribute('active');

            this.innerHTML = '<nav class="d-groups" aria-label="Queueify">' + GROUPS.map(group =>
                '<div class="d-group">' +
                  '<div class="d-group-title">' + icon(group.icon) + group.title + '</div>' +
                  '<div class="d-links">' + group.items.map(item => {
                      const lead = item.step
                          ? '<span class="dot"' + (views ? ' id="dot-' + item.view + '"' : '') + '>' + item.step + '</span>'
                          : icon(item.icon);
                      const body = lead + '<span class="d-link-name">' + item.name + '</span>' +
                          (item.optional ? '<span class="d-link-tag">optional</span>' : '');
                      const on = item.view === active ? ' active' : '';

                      return views
                          ? '<button type="button" class="d-link rail-item' + on + '" id="nav-' + item.view + '" data-view="' + item.view + '">' + body + '</button>'
                          : '<a class="d-link' + on + '" href="' + (item.page || '/#' + item.view) + '"' + (on ? ' aria-current="page"' : '') + '>' + body + '</a>';
                  }).join('') + '</div>' +
                '</div>'
            ).join('') + '</nav>';
        }
    });
})();
