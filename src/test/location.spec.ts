import { strict as assert } from 'node:assert';
import { test, describe } from 'node:test';
import { findLocationRefs, findLocationRefAt } from '../utils/locationResolver';

describe('Location calls', () => {
    test('parses a static Location call', () => {
        const refs = findLocationRefs('p = Location(10, 20)');
        assert.equal(refs.length, 1);
        assert.deepEqual(refs[0], { x: 10, y: 20, start: 4, end: 20 });
    });

    test('parses negative coordinates', () => {
        assert.deepEqual(
            findLocationRefs('Location(-10, -20)').map(r => [r.x, r.y]),
            [[-10, -20]]
        );
    });

    test('a Location mentioned only in a comment is ignored', () => {
        assert.deepEqual(findLocationRefs('# Location(1, 2) is disabled'), []);
    });

    test('a trailing comment does not affect parsing', () => {
        assert.equal(findLocationRefs('Location(1, 2)  # login button').length, 1);
    });

    test('does not match a call with a Location-suffixed name', () => {
        assert.deepEqual(findLocationRefs('MyLocation(1, 2)'), []);
    });

    test('does not match a Region call', () => {
        assert.deepEqual(findLocationRefs('Region(1, 2, 3, 4)'), []);
    });

    test('finds multiple Location calls on one line', () => {
        const line = 'dragDrop(Location(1, 2), Location(5, 6))';
        assert.deepEqual(findLocationRefs(line).map(r => r.x), [1, 5]);
    });

    test('findLocationRefAt targets the call under the cursor', () => {
        const line = 'a = Location(1, 2); b = Location(5, 6)';
        const second = line.indexOf('Location(5');
        assert.equal(findLocationRefAt(line, second)?.x, 5);
    });
});
