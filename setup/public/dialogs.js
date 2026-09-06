/**
 * Asking a yes/no question, without the browser's own box.
 *
 * `confirm()` is jarring: it is styled by the operating system, it says
 * "127.0.0.1 says", and the buttons never explain what they do. This is the
 * same question in the page's own clothes, with buttons that name the action.
 *
 * It is an enhancement, not a requirement: anything without <dialog> support
 * falls straight back to `confirm()`, so the question always gets asked.
 */
(() => {
    const supported = typeof HTMLDialogElement === 'function'
        && typeof HTMLDialogElement.prototype.showModal === 'function';

    document.head.insertAdjacentHTML('beforeend', `<style>
    .qask {
        width: min(420px, calc(100vw - 32px));
        padding: 0; border: 0; border-radius: 14px;
        background: #16161f; color: #f2f2f7;
        box-shadow: 0 24px 70px rgba(0, 0, 0, .55), 0 0 0 1px rgba(255, 255, 255, .1);
        font-family: inherit;
    }
    .qask::backdrop { background: rgba(6, 6, 10, .62); backdrop-filter: blur(2px); }

    .qask-body { padding: 22px 22px 6px; }
    .qask h2 { margin: 0 0 8px; font-size: 16.5px; letter-spacing: -.01em; }
    .qask p { margin: 0; color: #a8a8b8; font-size: 13.5px; line-height: 1.55; }

    .qask-buttons {
        display: flex; justify-content: flex-end; gap: 8px;
        padding: 18px 22px 20px;
    }
    .qask button {
        font: inherit; font-size: 13.5px; font-weight: 600;
        padding: 9px 16px; border: 0; border-radius: 8px;
        color: #fff; background: #9147ff; cursor: pointer;
        transition: background .15s, transform .1s;
    }
    .qask button:hover { background: #a061ff; }
    .qask button:active { transform: translateY(1px); }
    .qask button.quiet { background: #2b2b38; color: #e7e7ef; }
    .qask button.quiet:hover { background: #363646; }
    .qask button.danger { background: #b32744; }
    .qask button.danger:hover { background: #c93254; }

    /* Opening from nothing, so it does not simply blink into existence. */
    .qask[open] { animation: qask-in .16s ease-out; }
    @keyframes qask-in {
        from { opacity: 0; transform: translateY(6px) scale(.985); }
        to { opacity: 1; transform: none; }
    }
    @media (prefers-reduced-motion: reduce) { .qask[open] { animation: none; } }
    </style>`);

    /**
     * Asks the question and resolves to true when the answer is yes.
     *
     * `confirm` names the thing that will happen ("Discard changes"), because
     * a button called OK next to a question about losing work is no help.
     */
    window.askConfirm = function askConfirm(message, options = {}) {
        const { title = '', confirm = 'Yes', cancel = 'Cancel', danger = false } = options;

        if (!supported) {
            return Promise.resolve(window.confirm(title ? `${title}\n\n${message}` : message));
        }

        return new Promise(resolve => {
            const dialog = document.createElement('dialog');
            dialog.className = 'qask';

            const body = document.createElement('div');
            body.className = 'qask-body';

            if (title) {
                const heading = document.createElement('h2');
                heading.textContent = title;
                body.appendChild(heading);
            }

            const text = document.createElement('p');
            text.textContent = message;
            body.appendChild(text);

            const buttons = document.createElement('div');
            buttons.className = 'qask-buttons';

            const no = document.createElement('button');
            no.type = 'button';
            no.className = 'quiet';
            no.textContent = cancel;

            const yes = document.createElement('button');
            yes.type = 'button';
            if (danger) yes.className = 'danger';
            yes.textContent = confirm;

            buttons.append(no, yes);
            dialog.append(body, buttons);
            document.body.appendChild(dialog);

            let answer = false;
            no.addEventListener('click', () => dialog.close());
            yes.addEventListener('click', () => { answer = true; dialog.close(); });

            // Escape and clicking outside both mean no, the safe answer.
            dialog.addEventListener('click', event => {
                if (event.target === dialog) dialog.close();
            });

            dialog.addEventListener('close', () => {
                dialog.remove();
                resolve(answer);
            });

            dialog.showModal();
            // The cautious button is the one under your finger.
            no.focus();
        });
    };
})();
