import { strict as assert } from 'node:assert';
import { test, describe } from 'node:test';
import { buildRunArgs } from '../bridge/sikulixBridge';

const BASE = {
    javaPath: 'java',
    jarPath: '/opt/sikulixapi.jar',
    target: '/home/t/login.sikuli',
    cwd: '/home/t'
};

describe('SikuliX command line', () => {
    test('always routes output to the console and runs the target', () => {
        assert.deepEqual(buildRunArgs(BASE), [
            '-jar', '/opt/sikulixapi.jar', '-c', '-r', '/home/t/login.sikuli'
        ]);
    });

    test('omits -d at debug level 0, since the option rejects it', () => {
        assert.equal(buildRunArgs({ ...BASE, debugLevel: 0 }).includes('-d'), false);
    });

    test('passes a positive debug level through', () => {
        const args = buildRunArgs({ ...BASE, debugLevel: 3 });
        assert.deepEqual(args.slice(args.indexOf('-d'), args.indexOf('-d') + 2), ['-d', '3']);
    });

    test('JVM arguments precede -jar', () => {
        const args = buildRunArgs({ ...BASE, jvmArgs: ['-Xmx512m'] });
        assert.ok(args.indexOf('-Xmx512m') < args.indexOf('-jar'));
    });
});
