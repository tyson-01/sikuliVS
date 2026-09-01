import { strict as assert } from 'node:assert';
import { test, describe } from 'node:test';
import { findRegionRefs, findRegionRefAt } from '../utils/regionResolver';

describe('Region calls', () => {
    test('parses a static Region call', () => {
        const refs = findRegionRefs('r = Region(10, 20, 300, 400)');
        assert.equal(refs.length, 1);
        assert.deepEqual(refs[0], { x: 10, y: 20, w: 300, h: 400, start: 4, end: 28 });
    });

    test('parses negative x/y bounds', () => {
        assert.deepEqual(
            findRegionRefs('Region(-10, -20, 300, 400)').map(r => [r.x, r.y]),
            [[-10, -20]]
        );
    });

    test('a Region mentioned only in a comment is ignored', () => {
        assert.deepEqual(findRegionRefs('# Region(1, 2, 3, 4) is disabled'), []);
    });

    test('a trailing comment does not affect parsing', () => {
        assert.equal(findRegionRefs('Region(1, 2, 3, 4)  # login area').length, 1);
    });

    test('does not match a call with a Region-suffixed name', () => {
        assert.deepEqual(findRegionRefs('MyRegion(1, 2, 3, 4)'), []);
    });

    test('finds multiple Region calls on one line', () => {
        const line = 'merge(Region(1, 2, 3, 4), Region(5, 6, 7, 8))';
        assert.deepEqual(findRegionRefs(line).map(r => r.x), [1, 5]);
    });

    test('findRegionRefAt targets the call under the cursor', () => {
        const line = 'a = Region(1, 2, 3, 4); b = Region(5, 6, 7, 8)';
        const second = line.indexOf('Region(5');
        assert.equal(findRegionRefAt(line, second)?.x, 5);
    });
});
