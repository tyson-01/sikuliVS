import { strict as assert } from 'node:assert';
import { test, describe } from 'node:test';
import { ScriptErrorParser, errorSource } from '../utils/runErrors';

function parse(output: string) {
    const parser = new ScriptErrorParser();
    for (const line of output.split('\n')) {
        parser.push(line);
    }
    return { errors: parser.finish(), hadErrorOutput: parser.hadErrorOutput };
}

// Captured verbatim from SikuliX 2.0.5 on Java 17. The failure was on line 4, inside
// helper(); line 7 is only where the script called it.
const NAME_ERROR = [
    '[error] script [ nameerr ] stopped with error in line 7',
    "[error] NameError ( global name 'undefined_thing' is not defined )",
    '[error] --- Traceback --- error source first',
    'line: module ( function ) statement ',
    '4: main (  helper )     return undefined_thing',
    '7: main (  <module> )     helper()',
    '[error] --- Traceback --- end --------------'
].join('\n');

// Same, but the failure is inside a module the script imported from its bundle.
const IMPORTED_MODULE_ERROR = [
    '[error] script [ othername ] stopped with error in line 6',
    "[error] NameError ( global name 'missing_symbol' is not defined )",
    '[error] --- Traceback --- error source first',
    'line: module ( function ) statement ',
    '3: helperlib (  boom )     return x + missing_symbol',
    '4: main (  outer )     return helperlib.boom()',
    '6: main (  <module> )     outer()',
    '[error] --- Traceback --- end --------------'
].join('\n');

// The cause carries nested parentheses, which the cause pattern has to survive.
const FIND_FAILED = [
    '[error] script [ ff ] stopped with error in line 3',
    '[error] FindFailed ( nowhere.png: (40x40) in R[0,0 1280x800]@S(0) )',
    '[error] --- Traceback --- error source first',
    'line: module ( function ) statement ',
    '3: main (  <module> )     find("nowhere.png")',
    '[error] --- Traceback --- end --------------'
].join('\n');

const SYNTAX_ERROR = [
    '[error] script [ syntaxerr ] stopped with error in line 3 at column 7',
    `[error] SyntaxError ( "mismatched input '\\\\n' expecting COLON",  )`
].join('\n');

describe('SikuliX error output', () => {
    test('reports the exception and its cause', () => {
        const { errors } = parse(NAME_ERROR);

        assert.equal(errors.length, 1);
        assert.equal(errors[0].message, "NameError: global name 'undefined_thing' is not defined");
    });

    test('keeps a FindFailed cause whole despite its nested parentheses', () => {
        const { errors } = parse(FIND_FAILED);

        assert.equal(errors.length, 1);
        assert.equal(
            errors[0].message,
            'FindFailed: nowhere.png: (40x40) in R[0,0 1280x800]@S(0)'
        );
        assert.deepEqual(errorSource(errors[0]), { module: 'main', line: 3 });
    });

    test('reads a traceback statement that itself contains a call', () => {
        const { errors } = parse(FIND_FAILED);

        assert.deepEqual(errors[0].frames, [
            { line: 3, module: 'main', func: '<module>', statement: 'find("nowhere.png")' }
        ]);
    });

    test('blames the line that failed, not the line that called it', () => {
        const { errors } = parse(NAME_ERROR);

        assert.equal(errors[0].line, 7, 'summary line is the call site');
        assert.deepEqual(errorSource(errors[0]), { module: 'main', line: 4 });
    });

    test('attributes a failure to the module it happened in', () => {
        const { errors } = parse(IMPORTED_MODULE_ERROR);

        assert.deepEqual(errorSource(errors[0]), { module: 'helperlib', line: 3 });
        assert.deepEqual(
            errors[0].frames.map(f => [f.module, f.line]),
            [['helperlib', 3], ['main', 4], ['main', 6]]
        );
    });

    test('keeps the column a syntax error reports', () => {
        const { errors } = parse(SYNTAX_ERROR);

        assert.equal(errors.length, 1);
        assert.equal(errors[0].line, 3);
        assert.equal(errors[0].column, 7);
    });

    test('drops the trailing comma Jython leaves on a syntax error cause', () => {
        const { errors } = parse(SYNTAX_ERROR);

        assert.equal(errors[0].message, `SyntaxError: "mismatched input '\\\\n' expecting COLON"`);
    });

    test('falls back to the summary line when there is no traceback', () => {
        const { errors } = parse(SYNTAX_ERROR);

        assert.deepEqual(errorSource(errors[0]), { module: 'main', line: 3, column: 7 });
    });

    test('takes the line from the traceback when the summary has none', () => {
        const { errors } = parse(
            '[error] script [ login ] stopped with error at line --unknown--\n' +
            "[error] NameError ( name 'foo' is not defined )\n" +
            '[error] --- Traceback --- error source first\n' +
            'line: module ( function ) statement \n' +
            '7: main (  <module> ) foo()\n' +
            '[error] --- Traceback --- end --------------'
        );

        assert.equal(errors[0].line, 0);
        assert.equal(errorSource(errors[0]).line, 7);
    });

    test('a missing script is a launch failure, not a line', () => {
        const { errors } = parse('[error] Runner: runscript: (256) not found: /home/t/login.sikuli');

        assert.equal(errors.length, 1);
        assert.equal(errors[0].launchFailure, true);
        assert.equal(errors[0].line, 0);
        assert.match(errors[0].message, /not find the script/);
    });

    test('a clean run produces nothing', () => {
        const result = parse('plain stdout from jython\n[log] done');

        assert.deepEqual(result.errors, []);
        assert.equal(result.hadErrorOutput, false);
    });

    test('an unrecognised failure is still flagged as error output', () => {
        const result = parse('[error] Screen: initScreens: no screens found');

        assert.equal(result.hadErrorOutput, true);
    });

    test('separates two failures in one run', () => {
        const { errors } = parse(`${NAME_ERROR}\n${SYNTAX_ERROR}`);

        assert.equal(errors.length, 2);
        assert.match(errors[0].message, /^NameError/);
        assert.match(errors[1].message, /^SyntaxError/);
    });
});
