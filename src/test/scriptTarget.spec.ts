import { strict as assert } from 'node:assert';
import { test, describe } from 'node:test';
import { resolveScriptTarget, bundleName, isBundleDir } from '../utils/scriptTarget';

describe('Script target resolution', () => {
    test('a script inside a bundle runs as the bundle', () => {
        const target = resolveScriptTarget('/home/t/proj/login.sikuli/login.py');
        assert.deepEqual(target, {
            target: '/home/t/proj/login.sikuli',
            cwd: '/home/t/proj',
            pyFile: '/home/t/proj/login.sikuli/login.py',
            name: 'login'
        });
    });

    test('a loose script runs on its own, from its own directory', () => {
        const target = resolveScriptTarget('/home/t/proj/helper.py');
        assert.equal(target.target, '/home/t/proj/helper.py');
        assert.equal(target.cwd, '/home/t/proj');
        assert.equal(target.name, 'helper');
    });

    test('a differently named script in a bundle still reports the bundle name', () => {
        assert.equal(resolveScriptTarget('/home/t/login.sikuli/helpers.py').name, 'login');
    });

    test('.sikuli is only a bundle marker as a suffix', () => {
        assert.equal(isBundleDir('/home/t/my.sikuli.backup'), false);
        assert.equal(isBundleDir('/home/t/login.sikuli'), true);
    });

    test('bundleName strips the suffix without touching the rest of the name', () => {
        assert.equal(bundleName('/home/t/login.sikuli'), 'login');
        assert.equal(bundleName('/home/t/my.sikulix.project'), 'my.sikulix.project');
        assert.equal(bundleName('/home/t/plain'), 'plain');
    });
});
