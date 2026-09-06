/** The module name SikuliX gives the script it was pointed at; imports keep their own. */
export const SCRIPT_MODULE = 'main';

export interface ScriptFrame {
    line: number;
    module: string;
    func: string;
    statement: string;
}

export interface ScriptError {
    line: number;      // 1-based line in the script; 0 when SikuliX could not name one
    column?: number;
    message: string;
    /** Deepest call first, as SikuliX reports it. Empty when no traceback was printed. */
    frames: ScriptFrame[];
    /** True for failures that happened before the script ran, e.g. a bad path. */
    launchFailure?: boolean;
}

// [error] script [ login ] stopped with error in line 12
// [error] script [ login ] stopped with error in line 3 at column 7
const STOPPED_IN_LINE =
    /^\[error\]\s+script\s+\[\s*(.*?)\s*\]\s+stopped with error in line\s+(\d+)(?:\s+at column\s+(\d+))?/;
const STOPPED_UNKNOWN = /^\[error\]\s+script\s+\[\s*(.*?)\s*\]\s+stopped with error at line --unknown--/;

// [error] NameError ( global name 'undefined_thing' is not defined )
const CAUSE = /^\[error\]\s+([A-Za-z_][\w.]*)\s*\(\s*(.*?)\s*\)\s*$/;

// [error] Runner: runscript: (256) not found: /path/to/login.sikuli
const NOT_FOUND = /^\[error\]\s+Runner:\s+runscript:\s+\(\d+\)\s+not found:\s+(.+?)\s*$/;

const TRACE_START = /---\s*Traceback\s*---\s*error source first/;
const TRACE_END = /---\s*Traceback\s*---\s*end/;
// 4: main (  helper )     return undefined_thing
const TRACE_FRAME = /^\s*(\d+):\s*(\S+)\s*\(\s*(.*?)\s*\)\s*(.*)$/;

/**
 * Reads SikuliX's console output a line at a time and collects the script failures it
 * reports. Fed live during a run, so it never needs the whole output buffered.
 *
 * SikuliX announces a failure across several lines: the line number first, the exception
 * and its cause next, then an optional traceback block. Errors are therefore held open
 * until the next failure starts or the run ends.
 */
export class ScriptErrorParser {
    private readonly errors: ScriptError[] = [];
    private pending: ScriptError | null = null;
    private inTraceback = false;
    private sawErrorOutput = false;

    push(rawLine: string): void {
        const line = rawLine.replace(/\s+$/, '');

        if (line.startsWith('[error]')) {
            this.sawErrorOutput = true;
        }

        if (TRACE_END.test(line)) {
            this.inTraceback = false;
            this.flush();
            return;
        }

        if (TRACE_START.test(line)) {
            this.inTraceback = true;
            return;
        }

        if (this.inTraceback) {
            this.readTraceFrame(line);
            return;
        }

        const notFound = NOT_FOUND.exec(line);
        if (notFound) {
            this.flush();
            this.errors.push({
                line: 0,
                message: `SikuliX could not find the script: ${notFound[1]}`,
                frames: [],
                launchFailure: true
            });
            return;
        }

        const stopped = STOPPED_IN_LINE.exec(line);
        if (stopped) {
            this.flush();
            this.pending = {
                line: parseInt(stopped[2], 10),
                column: stopped[3] ? parseInt(stopped[3], 10) : undefined,
                message: 'Script stopped with an error',
                frames: []
            };
            return;
        }

        if (STOPPED_UNKNOWN.test(line)) {
            this.flush();
            this.pending = { line: 0, message: 'Script stopped with an error', frames: [] };
            return;
        }

        const cause = CAUSE.exec(line);
        if (cause && this.pending) {
            const [, errorType, rawDetail] = cause;
            // Jython's exception args arrive as a tuple, so a syntax error's detail keeps a
            // trailing comma from the empty slots: `SyntaxError ( "...",  )`.
            const detail = rawDetail.replace(/,\s*$/, '');
            this.pending.message = detail ? `${errorType}: ${detail}` : errorType;
        }
    }

    private readTraceFrame(line: string): void {
        const frame = TRACE_FRAME.exec(line);
        if (!frame || !this.pending) {
            return;   // The block's `line: module ( function ) statement` header
        }

        this.pending.frames.push({
            line: parseInt(frame[1], 10),
            module: frame[2],
            func: frame[3],
            statement: frame[4]
        });
    }

    /**
     * Closes off the run. Returns every failure found, most recent last.
     */
    finish(): ScriptError[] {
        this.inTraceback = false;
        this.flush();
        return this.errors;
    }

    /**
     * Whether SikuliX printed anything at all on its error channel. A non-zero exit with
     * this still false means the JVM died before SikuliX could report why.
     */
    get hadErrorOutput(): boolean {
        return this.sawErrorOutput;
    }

    private flush(): void {
        if (this.pending) {
            this.errors.push(this.pending);
            this.pending = null;
        }
    }
}

/**
 * Where the error actually happened, as opposed to where the script gave up.
 *
 * SikuliX's summary line names the outermost statement — for a failure inside a function
 * that is the call, not the bug. The traceback lists the deepest frame first, so that is
 * the line worth marking. A frame's module is `main` for the script itself and the module
 * name for anything it imported, which is what lets the caller find the right file.
 */
export function errorSource(error: ScriptError): { module: string; line: number; column?: number } {
    const deepest = error.frames[0];
    if (deepest) {
        return { module: deepest.module, line: deepest.line };
    }

    return { module: SCRIPT_MODULE, line: error.line, column: error.column };
}
