import { strict as assert } from 'node:assert';
import { test, describe, afterEach } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
    beginCaptureSession,
    discardPending,
    pendingCaptureDir,
    retainAfterSession,
    sweepStaleTempDirs
} from '../debug/captures';
import { boxStyle, buildOverlay, verdictsHtml } from '../debug/overlay';

const DAY_MS = 24 * 60 * 60 * 1000;

function makeDir(root: string, name: string, ageMs: number): string {
    const directory = path.join(root, name);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'frame-001.png'), 'x');

    const when = new Date(Date.now() - ageMs);
    fs.utimesSync(directory, when, when);
    return directory;
}

describe('Capture session lifecycle', () => {
    afterEach(() => discardPending());

    test('a session gets its own directory, outside the workspace', () => {
        const directory = beginCaptureSession();
        assert.equal(fs.existsSync(directory), true);
        assert.equal(path.dirname(directory), os.tmpdir());
        retainAfterSession(directory);
    });

    test('captures survive the session that made them', () => {
        const directory = beginCaptureSession();
        retainAfterSession(directory);

        assert.equal(fs.existsSync(directory), true,
            'a failed run\'s last screenshot must still be there to look at');
        assert.equal(pendingCaptureDir(), directory);
    });

    test('the next run is what clears the last one', () => {
        const first = beginCaptureSession();
        retainAfterSession(first);

        const second = beginCaptureSession();
        assert.equal(fs.existsSync(first), false);
        assert.equal(fs.existsSync(second), true);
        retainAfterSession(second);
    });

    test('discarding removes the kept directory and forgets it', () => {
        const directory = beginCaptureSession();
        retainAfterSession(directory);

        discardPending();
        assert.equal(fs.existsSync(directory), false);
        assert.equal(pendingCaptureDir(), null);
    });

    test('discarding twice is harmless', () => {
        retainAfterSession(beginCaptureSession());
        discardPending();
        assert.doesNotThrow(() => discardPending());
    });
});

describe('Stale temp directory sweep', () => {
    let root: string;

    afterEach(() => {
        discardPending();
        fs.rmSync(root, { recursive: true, force: true });
    });

    test('takes abandoned capture and launcher directories', () => {
        // Names must not begin with "sikuli": SikuliX deletes those itself.
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'sweep-test-'));
        const captures = makeDir(root, 'svs-captures-old', 3 * DAY_MS);
        const launcher = makeDir(root, 'svs-launch-old', 3 * DAY_MS);

        assert.equal(sweepStaleTempDirs(root), 2);
        assert.equal(fs.existsSync(captures), false);
        assert.equal(fs.existsSync(launcher), false);
    });

    test('leaves recent directories alone, since another window may be using them', () => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'sweep-test-'));
        const fresh = makeDir(root, 'svs-captures-fresh', 60_000);

        assert.equal(sweepStaleTempDirs(root), 0);
        assert.equal(fs.existsSync(fresh), true);
    });

    test('never touches directories that are not ours', () => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'sweep-test-'));
        const other = makeDir(root, 'someone-elses-work', 30 * DAY_MS);

        assert.equal(sweepStaleTempDirs(root), 0);
        assert.equal(fs.existsSync(other), true);
    });

    test('a missing root is not an error', () => {
        root = path.join(os.tmpdir(), 'sweep-test-does-not-exist');
        assert.equal(sweepStaleTempDirs(root), 0);
    });
});

describe('Overlay placement', () => {
    const screen = { w: 1920, h: 1080 };

    test('a match is placed as a percentage of the captured screen', () => {
        const style = boxStyle({ x: 960, y: 540, w: 192, h: 108 }, screen);
        assert.equal(style, 'left:50%; top:50%; width:10%; height:10%');
    });

    test('the origin maps to the top left corner', () => {
        assert.match(boxStyle({ x: 0, y: 0, w: 10, h: 10 }, screen), /^left:0%; top:0%/);
    });

    test('a zero-sized screen does not produce NaN in the style', () => {
        const style = boxStyle({ x: 5, y: 5, w: 5, h: 5 }, { w: 0, h: 0 });
        assert.equal(style.includes('NaN'), false);
    });
});

describe('Drawing the diagnosis over a capture', () => {
    const screen = { w: 1920, h: 1080 };
    const base = { imagePath: null, required: 0.7, inRegion: null, overall: null, region: null };

    test('a match outside the searched region is still drawn', () => {
        // A manually chosen image searches the whole screen, so there is no
        // region, and the match box must appear regardless.
        const overlay = buildOverlay(
            { ...base, overall: { score: 1, rect: { x: 0, y: 0, w: 220, h: 26 } } },
            screen
        );

        assert.match(overlay.html, /class="box match outside"/);
        assert.match(overlay.css, /#overlay-match \{ left:0%/);
    });

    test('positions go in the stylesheet, never in a style attribute', () => {
        // A webview nonce authorises a <style> element but not inline style
        // attributes, so an inline position is silently dropped and the box
        // collapses to nothing, which is exactly what happened.
        const overlay = buildOverlay({
            ...base,
            region: { x: 10, y: 10, w: 100, h: 100 },
            overall: { score: 0.5, rect: { x: 0, y: 0, w: 20, h: 20 } }
        }, screen);

        assert.equal(/style=/.test(overlay.html), false);
        assert.match(overlay.css, /#overlay-searched \{/);
        assert.match(overlay.css, /#overlay-match \{/);
    });

    test('both boxes are drawn when the region is known', () => {
        const { html } = buildOverlay({
            ...base,
            region: { x: 600, y: 400, w: 400, h: 300 },
            inRegion: { score: 0.22, rect: { x: 648, y: 575, w: 220, h: 26 } },
            overall: { score: 1, rect: { x: 0, y: 0, w: 220, h: 26 } }
        }, screen);

        assert.match(html, /class="box searched"/);
        assert.match(html, /class="box match outside"/);
    });

    test('a match found inside the region is not marked as outside it', () => {
        const { html } = buildOverlay({
            ...base,
            region: { x: 0, y: 0, w: 500, h: 500 },
            inRegion: { score: 0.9, rect: { x: 10, y: 10, w: 20, h: 20 } },
            overall: { score: 0.9, rect: { x: 10, y: 10, w: 20, h: 20 } }
        }, screen);

        assert.match(html, /class="box match"/);
        assert.equal(/outside/.test(html), false);
    });

    test('nothing found anywhere draws nothing but says why', () => {
        assert.deepEqual(buildOverlay({ ...base }, screen), { html: '', css: '' });
        assert.match(verdictsHtml({ ...base }), /nothing to outline/i);
    });

    test('a match at the required similarity reads as a timing problem', () => {
        const verdict = verdictsHtml({
            ...base,
            region: { x: 0, y: 0, w: 100, h: 100 },
            inRegion: { score: 0.98, rect: { x: 1, y: 1, w: 5, h: 5 } }
        });

        assert.match(verdict, /matches <strong>now<\/strong>/);
    });
});
