#!/usr/bin/env node
/**
 * Builds widget/public/fx-textures/ from Kenney's Particle Pack (CC0,
 * https://kenney.nl/assets/particle-pack):
 *
 *   node scripts/build-fx-textures.js "<path to kenney_particle-pack>"
 *
 * The pack's textures are 512px and keep their brightness in the color, with
 * dark fringes that are not see-through. effects.js tints them to the album's
 * colors, which only works on a plain mask, so each one is turned into white
 * with its brightness as the alpha - and shrunk to the size it is drawn at.
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

// Name -> the size it is kept at. Small sparks stay small; the big soft shapes
// that can fill a widget are kept bigger, or they would draw blurry.
const TEXTURES = {
    circle_05: 128, light_01: 128, star_01: 128, star_04: 128, star_05: 128, star_06: 128,
    star_07: 128, star_08: 128, star_09: 128, flare_01: 128, magic_05: 128,
    muzzle_02: 128, muzzle_04: 128, muzzle_05: 128, flame_05: 128, flame_06: 128,
    trace_06: 128, trace_07: 128,
    star_02: 128, star_03: 128, symbol_01: 128, symbol_02: 128, trace_01: 128, trace_02: 128,
    circle_02: 256, circle_03: 256, light_03: 256, magic_01: 256, magic_02: 256, magic_03: 256,
    smoke_04: 256, smoke_07: 256, smoke_08: 256, twirl_01: 256, twirl_02: 256, twirl_03: 256,
    circle_01: 256, circle_04: 256, light_02: 256, magic_04: 256,
    flame_01: 256, flame_02: 256, flame_03: 256, flame_04: 256,
    scorch_01: 256, scorch_02: 256, scorch_03: 256, scratch_01: 256,
    slash_01: 256, slash_02: 256, slash_03: 256, slash_04: 256,
    smoke_01: 256, smoke_02: 256, smoke_05: 256, smoke_09: 256, smoke_10: 256,
    spark_01: 256, spark_02: 256, spark_03: 256, spark_04: 256
};

const LICENSE = `The Glow and Magic effects are drawn with textures from:

Particle Pack (1.1)
by Kenney Vleugels (Kenney.nl)
https://kenney.nl/assets/particle-pack

Additional credit for creating filter templates:
Indigo Ray, Craig Nisbet, Zoltan Erdokovy, Heliagon, ThreeDee, Killst4r and Tim2501

License (Creative Commons Zero, CC0)
http://creativecommons.org/publicdomain/zero/1.0/

Thank you, Kenney. Support their work: http://support.kenney.nl

Turned into white masks and resized for Queueify by scripts/build-fx-textures.js.
`;

async function main() {
    const pack = process.argv[2];
    const source = pack && path.join(pack, 'PNG (Transparent)');
    if (!source || !fs.existsSync(source)) {
        console.error('Usage: node scripts/build-fx-textures.js "<path to kenney_particle-pack>"');
        process.exit(1);
    }

    const out = path.join(__dirname, '..', 'widget', 'public', 'fx-textures');
    fs.rmSync(out, { recursive: true, force: true });
    fs.mkdirSync(out, { recursive: true });

    const browser = await chromium.launch();
    const page = await browser.newPage();

    for (const [name, size] of Object.entries(TEXTURES)) {
        const data = fs.readFileSync(path.join(source, name + '.png')).toString('base64');
        const png = await page.evaluate(async ({ data, size }) => {
            const img = new Image();
            img.src = 'data:image/png;base64,' + data;
            await img.decode();
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = size;
            const ctx = canvas.getContext('2d');
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(img, 0, 0, size, size);
            const pixels = ctx.getImageData(0, 0, size, size);
            const d = pixels.data;
            for (let i = 0; i < d.length; i += 4) {
                const bright = Math.max(d[i], d[i + 1], d[i + 2]) / 255;
                d[i + 3] = Math.round(d[i + 3] * bright);
                d[i] = d[i + 1] = d[i + 2] = 255;
            }
            ctx.putImageData(pixels, 0, 0);
            return canvas.toDataURL('image/png').split(',')[1];
        }, { data, size });
        fs.writeFileSync(path.join(out, name + '.png'), Buffer.from(png, 'base64'));
    }

    fs.writeFileSync(path.join(out, 'LICENSE.txt'), LICENSE);
    await browser.close();
    console.log(`Wrote ${Object.keys(TEXTURES).length} textures to ${path.relative(process.cwd(), out)}`);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
