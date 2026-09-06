import { strict as assert } from 'node:assert';
import { test, describe } from 'node:test';
import { executableLine, launcherSource } from '../debug/launcher';

const SPEC = {
    port: 41234,
    script: '/home/t/proj/login.sikuli/login.py',
    bundle: '/home/t/proj/login.sikuli',
    roots: ['/home/t/proj'],
    stopOnEntry: false
};

describe('Debug launcher script', () => {
    test('hands the agent the port, script, bundle and roots', () => {
        const source = launcherSource(SPEC, '/tmp/sikulivs-debug-abc');

        assert.match(source, /sys\.path\.insert\(0, u"\/tmp\/sikulivs-debug-abc"\)/);
        assert.match(source, /import sikulivs_debug/);
        assert.match(source, /^ {4}41234,$/m);
        assert.match(source, /^ {4}u"\/home\/t\/proj\/login\.sikuli\/login\.py",$/m);
        assert.match(source, /^ {4}u"\/home\/t\/proj\/login\.sikuli",$/m);
        assert.match(source, /^ {4}\[u"\/home\/t\/proj"\],$/m);
    });

    test('runs the script in the interpreter namespace SikuliX prepared', () => {
        assert.match(launcherSource(SPEC, '/tmp/x'), /globals\(\)\)/);
    });

    test('stopOnEntry becomes a Python boolean', () => {
        assert.match(launcherSource(SPEC, '/tmp/x'), /^ {4}False,$/m);
        assert.match(launcherSource({ ...SPEC, stopOnEntry: true }, '/tmp/x'), /^ {4}True,$/m);
    });

    test('paths with quotes or backslashes stay one literal', () => {
        const source = launcherSource({ ...SPEC, script: '/home/t/od"d\\path.py' }, '/tmp/x');
        assert.match(source, /u"\/home\/t\/od\\"d\\\\path\.py"/);
    });

    test('a non-ASCII path survives verbatim, under the coding declaration that decodes it', () => {
        const source = launcherSource({ ...SPEC, bundle: '/home/t/café.sikuli' }, '/tmp/x');
        assert.match(source.split('\n')[0], /coding: utf-8/);
        assert.match(source, /u"\/home\/t\/café\.sikuli"/);
    });
});

describe('Breakpoint placement', () => {
    const source = [
        'x = 1',          // 1
        '',               // 2
        '# a comment',    // 3
        '    ',           // 4
        'y = 2',          // 5
        ''                // 6
    ];

    test('a line with code stays where it was set', () => {
        assert.equal(executableLine(source, 1), 1);
        assert.equal(executableLine(source, 5), 5);
    });

    test('blank lines and comments move the breakpoint to the next real line', () => {
        assert.equal(executableLine(source, 2), 5);
        assert.equal(executableLine(source, 3), 5);
        assert.equal(executableLine(source, 4), 5);
    });

    test('trailing whitespace at the end of a file leaves the line alone', () => {
        assert.equal(executableLine(source, 6), 6);
    });

    test('an unreadable file leaves every breakpoint where it was set', () => {
        assert.equal(executableLine([], 12), 12);
    });
});
