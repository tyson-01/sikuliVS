import { strict as assert } from 'node:assert';
import { test, describe } from 'node:test';
import * as path from 'path';
import { headfulMarker, javaBinary, jvmRoots, pythonCommand, venvBin } from '../utils/platform';

const WINDOWS_ENV = {
    ProgramFiles: 'C:\\Program Files',
    'ProgramFiles(x86)': 'C:\\Program Files (x86)',
    LOCALAPPDATA: 'C:\\Users\\t\\AppData\\Local'
};

describe('Platform table', () => {
    test('names the java binary per platform', () => {
        assert.equal(javaBinary('win32'), 'java.exe');
        assert.equal(javaBinary('linux'), 'java');
        assert.equal(javaBinary('darwin'), 'java');
    });

    test('looks for the AWT library each platform actually ships', () => {
        assert.deepEqual(headfulMarker('win32'), { dir: 'bin', file: 'awt.dll' });
        assert.deepEqual(headfulMarker('darwin'), { dir: 'lib', file: 'libawt_lwawt.dylib' });
        assert.deepEqual(headfulMarker('linux'), { dir: 'lib', file: 'libawt_xawt.so' });
    });

    test('scans the FHS locations on Linux, with no home suffix', () => {
        const { roots, homeSuffix } = jvmRoots('linux');
        assert.deepEqual(roots, ['/usr/lib/jvm', '/usr/java', '/opt/java']);
        assert.equal(homeSuffix, '');
    });

    test('reaches into the bundle on macOS', () => {
        const { roots, homeSuffix } = jvmRoots('darwin');
        assert.deepEqual(roots, ['/Library/Java/JavaVirtualMachines']);
        assert.equal(homeSuffix, path.join('Contents', 'Home'));
    });

    test('builds Windows roots from the environment, per vendor', () => {
        const { roots, homeSuffix } = jvmRoots('win32', WINDOWS_ENV);
        assert.equal(homeSuffix, '');
        assert.ok(roots.includes(path.join('C:\\Program Files', 'Eclipse Adoptium')));
        assert.ok(roots.includes(path.join('C:\\Program Files (x86)', 'Java')));
        assert.ok(roots.includes(path.join('C:\\Users\\t\\AppData\\Local', 'Programs', 'Java')));
    });

    test('skips Windows roots the environment does not define', () => {
        const { roots } = jvmRoots('win32', { ProgramFiles: 'C:\\Program Files' });
        assert.ok(roots.every(root => root.startsWith('C:\\Program Files')));
        assert.ok(roots.length > 0);
    });

    test('returns no Windows roots when the environment is empty', () => {
        assert.deepEqual(jvmRoots('win32', {}).roots, []);
    });

    test('names the venv interpreter and the bare command per platform', () => {
        assert.equal(venvBin('win32'), path.join('Scripts', 'python.exe'));
        assert.equal(venvBin('linux'), path.join('bin', 'python3'));
        assert.equal(pythonCommand('win32'), 'python');
        assert.equal(pythonCommand('darwin'), 'python3');
    });
});
