import { strict as assert } from 'node:assert';
import { test, describe } from 'node:test';
import { parseFindFailed } from '../debug/findFailed';

const TRACE = '\n  Line 2291, in file Region.java\n';

describe('Reading SikuliX failure messages', () => {
    test('recovers the image and the region actually searched', () => {
        const failure = parseFindFailed(
            'FindFailed: taskbar.png: (220x26) in R[600,400 400x300]@S(0)' + TRACE
        );

        assert.deepEqual(failure, {
            image: 'taskbar.png',
            region: { x: 600, y: 400, w: 400, h: 300 }
        });
    });

    test('survives the type name being prepended, however many times', () => {
        // Jython prepends the exception type to a message that already has it.
        for (const prefix of [
            'FindFailed: ',
            'FindFailed: FindFailed: ',
            'org.sikuli.script.FindFailed: FindFailed: '
        ]) {
            const failure = parseFindFailed(
                `${prefix}btn.png: (48x22) in R[0,0 1920x1080]@S(0)` + TRACE
            );
            assert.equal(failure?.image, 'btn.png', `failed for prefix "${prefix}"`);
        }
    });

    test('handles the image half in every shape SikuliX writes it', () => {
        const shapes: [string, string][] = [
            ['gone.png: (0x0)', 'gone.png'],          // resolved, empty
            ['gone.png not loaded', 'gone.png'],       // never found on disk
            ['hello as text', 'hello']                 // OCR search
        ];

        for (const [half, expected] of shapes) {
            const failure = parseFindFailed(`FindFailed: ${half} in R[1,2 3x4]@S(0)`);
            assert.equal(failure?.image, expected, `failed for "${half}"`);
        }
    });

    test('an absolute path stays whole, colons and all', () => {
        const failure = parseFindFailed(
            'FindFailed: /home/t/proj/login.sikuli/btn.png: (48x22) in R[0,0 100x100]@S(0)'
        );
        assert.equal(failure?.image, '/home/t/proj/login.sikuli/btn.png');
    });

    test('reads the region even when it is a Match rather than a Region', () => {
        const failure = parseFindFailed(
            'FindFailed: a.png: (5x5) in M[10,20 30x40] S:0.99 C:25,40 [-1 msec]'
        );
        assert.deepEqual(failure?.region, { x: 10, y: 20, w: 30, h: 40 });
    });

    test('a screen left of the primary keeps its negative coordinates', () => {
        const failure = parseFindFailed(
            'FindFailed: a.png: (10x10) in R[-1920,-200 1920x1080]@S(1)'
        );
        assert.deepEqual(failure?.region, { x: -1920, y: -200, w: 1920, h: 1080 });
    });

    test('names with spaces and dots survive', () => {
        const failure = parseFindFailed('FindFailed: my button v2.png: (5x5) in R[1,2 3x4]@S(0)');
        assert.equal(failure?.image, 'my button v2.png');
    });

    test('a different failure is not mistaken for one of these', () => {
        assert.equal(parseFindFailed('NameError: name x is not defined'), null);
        assert.equal(parseFindFailed('FindFailed: something vague'), null);
        assert.equal(parseFindFailed(''), null);
    });
});

describe('The "seen at" clause SikuliX adds once it has found an image before', () => {
    // The real-world case that broke this: an image that IS on screen, searched
    // for in the wrong region. SikuliX volunteers where it last saw it, and that
    // clause sits between the name and the region.
    const message =
        'FindFailed: FindFailed: taskbar.png: (220x26) seen at (0, 0) with 1.00 ' +
        'in R[600,400 400x300]@S(0)\n  Line 2226, in file Region.java';

    test('does not swallow the clause into the image name', () => {
        assert.equal(parseFindFailed(message)?.image, 'taskbar.png');
    });

    test('still reads the region that was searched', () => {
        assert.deepEqual(parseFindFailed(message)?.region, { x: 600, y: 400, w: 400, h: 300 });
    });

    test('keeps what SikuliX said about where it last saw it', () => {
        assert.deepEqual(parseFindFailed(message)?.lastSeen, { x: 0, y: 0, score: 1 });
    });

    test('absent when SikuliX has never found the image', () => {
        assert.equal(
            parseFindFailed('FindFailed: a.png: (1x1) in R[0,0 9x9]@S(0)')?.lastSeen,
            undefined
        );
    });
});
