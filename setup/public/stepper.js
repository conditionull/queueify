/**
 * Press-and-hold for the - and + buttons beside a number.
 *
 * Every number on these pages has a pair of them, and some of the ranges go to
 * 3600, which is an unreasonable number of clicks one at a time. Holding a
 * button repeats, and the longer it is held the bigger each step gets, so a
 * field can be crossed in a couple of seconds and still be landed on exactly by
 * letting go early and tapping.
 *
 * Shared by the admin panel and the theme editor, which each had their own
 * stepper and neither of which repeated.
 */
(function () {
    'use strict';

    // Long enough that an ordinary click is only ever one step.
    const HOLD_BEFORE_REPEAT_MS = 400;
    const REPEAT_EVERY_MS = 60;

    /**
     * How many steps this tick is worth.
     *
     * Ramped rather than smooth so the sizes stay predictable: a moment of
     * single steps to nudge with, then 5s, then 25s, then 100s for the fields
     * that run to an hour.
     */
    function stepFor(ticks) {
        if (ticks < 10) return 1;
        if (ticks < 25) return 5;
        if (ticks < 45) return 25;
        return 100;
    }

    /**
     * Wire a button so it acts once when clicked and keeps acting when held.
     *
     * `action` is called with the number of steps to move, so a caller with its
     * own step size (the editor works in tenths in places) multiplies rather
     * than assuming 1.
     */
    window.holdRepeat = function holdRepeat(button, action) {
        let startTimer = null;
        let repeatTimer = null;
        let ticks = 0;

        function stop() {
            clearTimeout(startTimer);
            clearInterval(repeatTimer);
            startTimer = null;
            repeatTimer = null;
            ticks = 0;
            window.removeEventListener('pointerup', stop);
            window.removeEventListener('pointercancel', stop);
        }

        button.addEventListener('pointerdown', event => {
            // Left button only, and never start a second run inside one hold.
            if (event.button !== 0 || startTimer || repeatTimer) return;

            // Keeps the press from selecting the label or focusing the button,
            // so the number beside it keeps the caret.
            event.preventDefault();
            action(1);

            // On window, not the button: a pointer that drifts off the button
            // mid-hold still has to end the run.
            window.addEventListener('pointerup', stop);
            window.addEventListener('pointercancel', stop);

            startTimer = setTimeout(() => {
                repeatTimer = setInterval(() => {
                    ticks += 1;
                    action(stepFor(ticks));
                }, REPEAT_EVERY_MS);
            }, HOLD_BEFORE_REPEAT_MS);
        });

        // A button reached by keyboard fires click with no pointer behind it
        // (detail 0). Pointer-driven clicks are already handled above.
        button.addEventListener('click', event => {
            if (event.detail === 0) action(1);
        });

        // Holding the button and switching window or tab must not leave it
        // running in the background.
        button.addEventListener('blur', stop);
        window.addEventListener('blur', stop);
    };
}());
