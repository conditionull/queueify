const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

/**
 * What `matchWidgetToScreen` actually sends to OBS.
 *
 * The rest of the sizing has unit tests, but this is the function that talks
 * to OBS - and it is where a fix once failed to land unnoticed, because
 * nothing here needed a real OBS to be running. So OBS is stood in for.
 */

const obsPath = path.join(__dirname, '..', 'services', 'obs.js');
const liveEnvPath = path.join(__dirname, '..', 'config', 'liveEnv.js');
const envFilePath = path.join(__dirname, '..', 'setup', 'envFile.js');
const websocketPath = require.resolve('obs-websocket-js');

/** A scene item as OBS would describe it. */
function transform({ sourceWidth, sourceHeight, scaleX = 1, scaleY = 1, bounds = null }) {
    return {
        sourceWidth,
        sourceHeight,
        scaleX,
        scaleY,
        positionX: 0,
        positionY: 0,
        boundsType: bounds ? bounds.type : 'OBS_BOUNDS_NONE',
        boundsWidth: bounds ? bounds.width : 0,
        boundsHeight: bounds ? bounds.height : 0
    };
}

function withFakeObs(item, run, { inputKind = 'browser_source', laggyResize = false } = {}) {
    const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'queueify-obs-'));
    process.env.QUEUEIFY_ENV_FILE = path.join(sandbox, '.env');
    fs.writeFileSync(process.env.QUEUEIFY_ENV_FILE,
        'OBS_WEBSOCKET_IP=127.0.0.1\nOBS_SCENE=Gaming\nOBS_SOURCE=Queueify\n');

    const sent = [];
    let current = item;

    class FakeObsWebSocket {
        constructor() { this.identified = false; }
        on() {}
        off() {}
        async connect() { this.identified = true; }
        async disconnect() { this.identified = false; }

        async call(request, payload) {
            sent.push({ request, payload });

            switch (request) {
                case 'GetSceneItemList':
                    return { sceneItems: [{ sourceName: 'Queueify', sceneItemId: 7 }] };
                case 'GetSceneItemTransform':
                    return { sceneItemTransform: current };
                case 'GetInputSettings':
                    return { inputKind, inputSettings: {} };
                case 'SetInputSettings':
                    // OBS resizes a browser source asynchronously: read the
                    // transform back straight afterwards and sourceWidth is
                    // still the old number. `laggyResize` models that.
                    if (!laggyResize) {
                        current = {
                            ...current,
                            sourceWidth: payload.inputSettings.width,
                            sourceHeight: payload.inputSettings.height
                        };
                    }
                    return {};
                case 'SetSceneItemTransform':
                    current = { ...current, ...payload.sceneItemTransform };
                    return {};
                default:
                    return {};
            }
        }
    }

    // Stand in for the real client before services/obs.js constructs one.
    const realWebsocket = require.cache[websocketPath];
    require.cache[websocketPath] = {
        id: websocketPath,
        filename: websocketPath,
        loaded: true,
        exports: { OBSWebSocket: FakeObsWebSocket, EventSubscription: { All: 1, SceneItemTransformChanged: 2 } }
    };

    for (const modulePath of [envFilePath, liveEnvPath, obsPath]) {
        delete require.cache[require.resolve(modulePath)];
    }

    const obs = require(obsPath);
    const of = request => sent.filter(entry => entry.request === request);

    return Promise.resolve(run({ obs, of, item: () => current }))
        .finally(() => {
            if (realWebsocket) require.cache[websocketPath] = realWebsocket;
            else delete require.cache[websocketPath];

            for (const modulePath of [envFilePath, liveEnvPath, obsPath]) {
                delete require.cache[require.resolve(modulePath)];
            }
            delete process.env.QUEUEIFY_ENV_FILE;
            fs.rmSync(sandbox, { recursive: true, force: true });
        });
}

test('a tall theme in a wide slot is fitted into it, not stretched across it', () => {
    // The widget occupies 680 x 192 on the canvas, left over from a wide theme.
    return withFakeObs(transform({ sourceWidth: 680, sourceHeight: 192 }), async ({ obs, of }) => {
        const result = await obs.matchWidgetToScreen({ designWidth: 300, designHeight: 406 });

        const [resize] = of('SetInputSettings');
        assert.deepStrictEqual(resize.payload.inputSettings, { width: 300, height: 406 });
        assert.strictEqual(result.refitted, true);

        // The one thing that must never happen: an uneven scale.
        const [scale] = of('SetSceneItemTransform');
        assert.ok(Math.abs(scale.payload.sceneItemTransform.scaleX
            - scale.payload.sceneItemTransform.scaleY) < 0.001);

        // And it stays inside the space it had rather than spilling out of it.
        assert.ok(300 * scale.payload.sceneItemTransform.scaleX <= 680.5);
        assert.ok(406 * scale.payload.sceneItemTransform.scaleY <= 192.5);
    });
});

test('a source already right for the design is left completely alone', () => {
    return withFakeObs(transform({ sourceWidth: 680, sourceHeight: 192 }), async ({ obs, of }) => {
        const result = await obs.matchWidgetToScreen({ designWidth: 680, designHeight: 192 });

        assert.strictEqual(result.unchanged, true);
        assert.strictEqual(of('SetInputSettings').length, 0);
        assert.strictEqual(of('SetSceneItemTransform').length, 0);
    });
});

test('a bounding box of the wrong shape is brought to the design, not left to stretch it', () => {
    const item = transform({
        sourceWidth: 680,
        sourceHeight: 192,
        bounds: { type: 'OBS_BOUNDS_STRETCH', width: 680, height: 192 }
    });

    return withFakeObs(item, async ({ obs, of }) => {
        await obs.matchWidgetToScreen({ designWidth: 300, designHeight: 406 });

        const [bounded] = of('SetSceneItemTransform');
        const box = bounded.payload.sceneItemTransform;

        assert.ok(box.boundsWidth && box.boundsHeight, 'the box itself is what gets corrected');
        assert.ok(Math.abs(box.boundsWidth / box.boundsHeight - 300 / 406) < 0.001);
        // The scale is not touched: a bounded item is sized by its box.
        assert.strictEqual(box.scaleX, undefined);
    });
});

test('a bounding box already the right shape is not touched', () => {
    const item = transform({
        sourceWidth: 300,
        sourceHeight: 406,
        bounds: { type: 'OBS_BOUNDS_SCALE_INNER', width: 150, height: 203 }
    });

    return withFakeObs(item, async ({ obs, of }) => {
        const result = await obs.matchWidgetToScreen({ designWidth: 300, designHeight: 406 });

        assert.strictEqual(result.unchanged, true);
        assert.strictEqual(of('SetSceneItemTransform').length, 0);
    });
});

test('a source that is not a browser source is refused, by name', () => {
    return withFakeObs(transform({ sourceWidth: 680, sourceHeight: 192 }), async ({ obs, of }) => {
        await assert.rejects(
            () => obs.matchWidgetToScreen({ designWidth: 680, designHeight: 192 }),
            err => {
                assert.strictEqual(err.code, 'obs_not_browser_source');
                assert.match(err.message, /Queueify/);
                assert.match(err.message, /image_source/);
                return true;
            }
        );

        // Nothing was changed on the way to finding out.
        assert.strictEqual(of('SetInputSettings').length, 0);
    }, { inputKind: 'image_source' });
});

/** Framed filling a 680 x 192 source at 1:1, bottom-centred on 1920 x 1080. */
const framedBottom = {
    x: 620, y: 888,
    width: 680, height: 192,
    alignment: 5,
    kind: 'bottomcenter'
};

/**
 * The reported round trip: a widget framed with `!bc` under one theme, sent
 * away to a scene using another, and brought back. It has to land in the same
 * rectangle - and sizing the source and then repositioning as two steps is
 * what failed to, because the second step read the source size back from OBS
 * before OBS had finished applying the first.
 */
test('a saved position is landed in exactly, whatever the last theme left behind', () => {
    // Another theme has left the item at 1137 x 321 on the canvas.
    const item = transform({ sourceWidth: 1137, sourceHeight: 321, scaleX: 1, scaleY: 1 });

    return withFakeObs(item, async ({ obs, of }) => {
        await obs.matchWidgetToScreen({ designWidth: 680, designHeight: 192, place: framedBottom });

        const [resize] = of('SetInputSettings');
        const wanted = of('SetSceneItemTransform')[0].payload.sceneItemTransform;

        assert.strictEqual(wanted.positionX, 620);
        assert.strictEqual(wanted.positionY, 888);

        // The scale has to match the size the source is being set to, not the
        // size it had a moment ago.
        assert.ok(Math.abs(resize.payload.inputSettings.width * wanted.scaleX - 680) < 0.5,
            'the widget did not land on the width it was framed at');
        assert.ok(Math.abs(resize.payload.inputSettings.height * wanted.scaleY - 192) < 0.5,
            'the widget did not land on the height it was framed at');
    });
});

/**
 * The bug itself. OBS applies a browser source resize asynchronously, so a
 * `sourceWidth` read back straight afterwards is the old one - and a scale
 * worked out from it is wrong by exactly the ratio between the two themes.
 */
test('a resize OBS has not applied yet cannot throw the position off', () => {
    const item = transform({ sourceWidth: 1137, sourceHeight: 321, scaleX: 1, scaleY: 1 });

    return withFakeObs(item, async ({ obs, of, item: latest }) => {
        await obs.matchWidgetToScreen({ designWidth: 680, designHeight: 192, place: framedBottom });

        // OBS still reports the old size throughout, and it must not matter.
        assert.strictEqual(latest().sourceWidth, 1137);

        const [resize] = of('SetInputSettings');
        const wanted = of('SetSceneItemTransform')[0].payload.sceneItemTransform;

        assert.ok(Math.abs(resize.payload.inputSettings.width * wanted.scaleX - 680) < 0.5,
            'the scale was worked out against the size OBS had not finished leaving');
    }, { laggyResize: true });
});

test('a saved position never sends an uneven scale', () => {
    const item = transform({ sourceWidth: 550, sourceHeight: 120, scaleX: 0.72, scaleY: 0.55 });

    return withFakeObs(item, async ({ obs, of }) => {
        await obs.matchWidgetToScreen({
            designWidth: 550,
            designHeight: 120,
            // What compounding rescales left behind in real saved settings.
            place: { x: 715, y: 962, width: 490, height: 107, alignment: 5, kind: 'bottomcenter' }
        });

        const wanted = of('SetSceneItemTransform')[0].payload.sceneItemTransform;
        assert.strictEqual(wanted.scaleX, wanted.scaleY);
    });
});

test('a widget that has to change size keeps the edges its command names', () => {
    const item = transform({ sourceWidth: 680, sourceHeight: 192, scaleX: 1, scaleY: 1 });

    return withFakeObs(item, async ({ obs, of }) => {
        // The design is now tall, so it cannot be the size it was framed at.
        await obs.matchWidgetToScreen({ designWidth: 300, designHeight: 406, place: framedBottom });

        const wanted = of('SetSceneItemTransform')[0].payload.sceneItemTransform;
        const [resize] = of('SetInputSettings');

        const height = resize.payload.inputSettings.height * wanted.scaleY;
        const width = resize.payload.inputSettings.width * wanted.scaleX;

        // Bottom edge and centre line held, which is what "bottom centre" means.
        assert.ok(Math.abs((wanted.positionY + height) - (888 + 192)) < 0.5);
        assert.ok(Math.abs((wanted.positionX + width / 2) - (620 + 340)) < 0.5);
    });
});

test('with no saved position the widget is sized where it already is', () => {
    const item = transform({ sourceWidth: 680, sourceHeight: 192, scaleX: 2, scaleY: 2 });
    item.positionX = 100;
    item.positionY = 200;

    return withFakeObs(item, async ({ obs, of }) => {
        await obs.matchWidgetToScreen({ designWidth: 680, designHeight: 192 });

        const wanted = of('SetSceneItemTransform')[0].payload.sceneItemTransform;
        assert.strictEqual(wanted.positionX, 100);
        assert.strictEqual(wanted.positionY, 200);
    });
});

/**
 * The whole reported sequence: gaming scene on one theme, BRB on another, back
 * and forth. Each theme has its own saved position, and each has to land on it
 * every single time - no creep.
 */
test('switching back and forth between two themes never drifts', () => {
    const piss = {
        design: { width: 550, height: 120 },
        place: { x: 715, y: 962, width: 490, height: 107, alignment: 5, kind: 'bottomcenter' }
    };

    const swag = {
        design: { width: 680, height: 165 },
        place: { x: 803, y: 995, width: 314, height: 76, alignment: 5, kind: 'bottomcenter' }
    };

    const item = transform({ sourceWidth: 550, sourceHeight: 120, scaleX: 0.89, scaleY: 0.89 });

    return withFakeObs(item, async ({ obs, of, item: latest }) => {
        for (const theme of [swag, piss, swag, piss, swag, piss]) {
            await obs.matchWidgetToScreen({
                designWidth: theme.design.width,
                designHeight: theme.design.height,
                place: theme.place
            });

            const now = latest();
            const shownWidth = now.sourceWidth * now.scaleX;
            const shownHeight = now.sourceHeight * now.scaleY;

            // Bottom edge and centre line, which is what !bc framed.
            assert.ok(Math.abs((now.positionY + shownHeight) - (theme.place.y + theme.place.height)) < 1,
                'the bottom edge drifted to ' + (now.positionY + shownHeight));
            assert.ok(Math.abs((now.positionX + shownWidth / 2) - (theme.place.x + theme.place.width / 2)) < 1,
                'the centre line drifted to ' + (now.positionX + shownWidth / 2));

            assert.strictEqual(now.scaleX, now.scaleY, 'the widget came back stretched');
        }

        // Each switch is one resize and one transform write, not two of each.
        assert.strictEqual(of('SetSceneItemTransform').length, 6);
    });
});
