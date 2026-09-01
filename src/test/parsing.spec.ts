import { strict as assert } from 'node:assert';
import { test, describe, before, after } from 'node:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { findImageRefs, findImageRefAt, imagePatternToRegExp, resolveImageFiles } from '../utils/imageResolver';
import { parsePatternExpr, renderPatternExpr, PatternUpdates } from '../utils/patternExpression';

// Mirrors the commands: rewrite only the Pattern expression's own range.
function edit(line: string, updates: PatternUpdates, character = 0): string {
    const ref = findImageRefAt(line, character);
    assert.ok(ref, `no image reference found in: ${line}`);
    const expr = parsePatternExpr(line, ref);
    return line.slice(0, expr.start) + renderPatternExpr(expr, updates) + line.slice(expr.end);
}

describe('Pattern expressions', () => {
    test('wraps a bare string', () => {
        assert.equal(
            edit('click("a.png")', { similar: 0.85 }),
            'click(Pattern("a.png").similar(0.85))'
        );
    });

    test('uses the SikuliX similar() setter', () => {
        const out = edit('click("a.png")', { similar: 0.85 });
        assert.ok(out.includes('.similar(0.85)'));
        assert.ok(!out.includes('.similarity('));
    });

    test('updates an existing similar() rather than appending a second one', () => {
        const out = edit('click(Pattern("a.png").similar(0.70))', { similar: 0.85 });
        assert.equal(out, 'click(Pattern("a.png").similar(0.85))');
        assert.equal(out.match(/similar\(/g)?.length, 1);
    });

    test('reads the current similarity as the starting point', () => {
        const line = 'click(Pattern("a.png").similar(0.42))';
        assert.equal(parsePatternExpr(line, findImageRefAt(line, 0)!).similar, 0.42);
    });

    test('reads the current target offset as the starting point', () => {
        const line = 'click(Pattern("a.png").targetOffset(-3, 8))';
        assert.deepEqual(parsePatternExpr(line, findImageRefAt(line, 0)!).targetOffset, [-3, 8]);
    });
});

describe('modifier chain', () => {
    test('keeps unrecognised modifiers and their order', () => {
        assert.equal(
            edit('click(Pattern("a.png").mask("m.png").similar(0.70))', { similar: 0.85 }),
            'click(Pattern("a.png").mask("m.png").similar(0.85))'
        );
    });

    test('keeps exact() and resize()', () => {
        assert.equal(
            edit('click(Pattern("a.png").resize(1.5).exact())', { similar: 0.9 }),
            'click(Pattern("a.png").resize(1.5).exact().similar(0.90))'
        );
    });

    test('updates targetOffset without reordering the chain', () => {
        assert.equal(
            edit('click(Pattern("a.png").similar(0.70).targetOffset(2, 3))', { targetOffset: [-4, 8] }),
            'click(Pattern("a.png").similar(0.70).targetOffset(-4, 8))'
        );
    });

    test('a zero offset drops the modifier', () => {
        assert.equal(
            edit('click(Pattern("a.png").targetOffset(5, 5))', { targetOffset: [0, 0] }),
            'click("a.png")'
        );
    });
});

describe('dynamic image strings', () => {
    test('f-string keeps its prefix', () => {
        assert.equal(
            edit('click(Pattern(f"btn_{state}.png").similar(0.70))', { similar: 0.85 }),
            'click(Pattern(f"btn_{state}.png").similar(0.85))'
        );
    });

    test('bare f-string gets wrapped', () => {
        assert.equal(
            edit('click(f"btn_{state}.png")', { similar: 0.85 }),
            'click(Pattern(f"btn_{state}.png").similar(0.85))'
        );
    });

    test('percent formatting keeps its operand inside the Pattern', () => {
        assert.equal(
            edit('click(Pattern("btn_%s.png" % state).similar(0.70))', { similar: 0.85 }),
            'click(Pattern("btn_%s.png" % state).similar(0.85))'
        );
    });

    test('percent formatting with a tuple operand', () => {
        assert.equal(
            edit('click("btn_%s_%d.png" % (name, n))', { similar: 0.8 }),
            'click(Pattern("btn_%s_%d.png" % (name, n)).similar(0.80))'
        );
    });

    test('.format() call is carried along', () => {
        assert.equal(
            edit('click(Pattern("btn_{}.png".format(state)).similar(0.70))', { similar: 0.85 }),
            'click(Pattern("btn_{}.png".format(state)).similar(0.85))'
        );
    });
});

describe('multiple images on one line', () => {
    const LINE = 'if exists("a.png"): click("b.png")';

    test('both references are found', () => {
        assert.deepEqual(findImageRefs(LINE).map(r => r.namePattern), ['a.png', 'b.png']);
    });

    test('editing targets the reference under the cursor', () => {
        assert.equal(
            edit(LINE, { similar: 0.9 }, LINE.indexOf('"b.png"')),
            'if exists("a.png"): click(Pattern("b.png").similar(0.90))'
        );
    });

    test('the other reference is left untouched', () => {
        assert.equal(
            edit(LINE, { similar: 0.9 }, LINE.indexOf('"a.png"')),
            'if exists(Pattern("a.png").similar(0.90)): click("b.png")'
        );
    });
});

describe('line integrity', () => {
    test('a trailing comment survives', () => {
        assert.equal(
            edit('click("a.png")  # login button', { similar: 0.85 }),
            'click(Pattern("a.png").similar(0.85))  # login button'
        );
    });

    test('an image mentioned only in a comment is ignored', () => {
        assert.deepEqual(findImageRefs('# click("a.png") is disabled'), []);
    });

    test('a quote following an identifier is not a literal', () => {
        assert.deepEqual(findImageRefs('foo = bar"a.png"'), []);
    });
});

describe('filename pattern matching', () => {
    const cases: [string, string[], string[]][] = [
        // pattern,           should match,                     should not match
        ['btn_%s.png',        ['btn_ok.png', 'btn_a_b.png'],    ['btn.png', 'x_btn_ok.png']],
        ['btn_%d.png',        ['btn_12.png'],                   ['btn_ok.png']],
        ['btn_%03d.png',      ['btn_007.png'],                  ['btn_ok.png']],
        ['btn_%(name)s.png',  ['btn_ok.png'],                   ['btn.png']],
        ['btn_{}.png',        ['btn_ok.png'],                   ['btn.png']],
        ['btn_{0}.png',       ['btn_ok.png'],                   ['btn.png']],
        ['btn_{name}.png',    ['btn_ok.png'],                   ['btn.png']],
        ['btn_{n:03d}.png',   ['btn_007.png'],                  ['btn_ok.png']],
        ['btn_{n!r:^8}.png',  ['btn_ok.png'],                   ['btn.png']],
        ['100%%_done.png',    ['100%_done.png'],                ['100_done.png']],
        ['btn_{{x}}.png',     ['btn_{x}.png'],                  ['btn_y.png']],
        ['plain.png',         ['plain.png'],                    ['plain2.png']]
    ];

    for (const [pattern, hits, misses] of cases) {
        test(`${pattern}`, () => {
            const regex = imagePatternToRegExp(pattern);
            for (const hit of hits) {
                assert.ok(regex.test(hit), `${pattern} should match ${hit}`);
            }
            for (const miss of misses) {
                assert.ok(!regex.test(miss), `${pattern} should not match ${miss}`);
            }
        });
    }

    test('f-string expressions with quotes and operators parse', () => {
        assert.ok(imagePatternToRegExp("btn_{d['k']}.png").test('btn_ok.png'));
        assert.ok(imagePatternToRegExp('btn_{a + b}.png').test('btn_ok.png'));
    });
});

describe('resolving files on disk', () => {
    const FILES = ['shot_12.png', 'shot_7.png', 'shot_ok.png', 'other.png'];
    let dir: string;

    const namesFor = (line: string) =>
        resolveImageFiles(findImageRefs(line)[0], dir).map(p => path.basename(p));

    before(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sikulivs-'));
        for (const name of FILES) {
            fs.writeFileSync(path.join(dir, name), '');
        }
    });

    after(() => fs.rmSync(dir, { recursive: true, force: true }));

    test('a static name resolves to just that file', () => {
        assert.deepEqual(namesFor('click("shot_ok.png")'), ['shot_ok.png']);
    });

    test('%s resolves every variant, which the match carousel previews together', () => {
        assert.deepEqual(namesFor('click("shot_%s.png" % state)'), ['shot_12.png', 'shot_7.png', 'shot_ok.png']);
    });

    test('%d resolves only the numeric variants', () => {
        assert.deepEqual(namesFor('click("shot_%d.png" % n)'), ['shot_12.png', 'shot_7.png']);
    });

    test('an f-string resolves the same set as %s', () => {
        const ref = findImageRefs('click(f"shot_{state}.png")')[0];
        assert.equal(ref.kind, 'fstring');
        assert.deepEqual(namesFor('click(f"shot_{state}.png")'), ['shot_12.png', 'shot_7.png', 'shot_ok.png']);
    });

    test('.format() resolves the same set as %s', () => {
        assert.deepEqual(namesFor('click("shot_{}.png".format(state))'), ['shot_12.png', 'shot_7.png', 'shot_ok.png']);
    });

    test('a name with no file on disk resolves to nothing', () => {
        assert.deepEqual(namesFor('click("missing.png")'), []);
    });
});
