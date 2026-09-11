import { spawn } from 'child_process';

export interface SikulixLaunch {
    javaPath: string;
    jarPath: string;
    target: string;   // Bundle folder or script file for SikuliX's -r
    cwd: string;
    jvmArgs?: string[];
    debugLevel?: number;
}

export interface SikulixRun {
    /** Resolves with the process exit code once SikuliX has finished. */
    exited: Promise<number>;
    stop(): void;
}

const KILL_GRACE_MS = 3000;

/**
 * Puts Java in device pixels.
 *
 * On a display scaled above 100%, Java's user space is logical pixels while the visual
 * tools report device pixels. A 3840x2160 screen at 150% makes Java see 2560x1440, so a
 * Region captured at one place is searched for at that place multiplied by the scale, and
 * a captured image is half again larger than the same thing in Java's own screenshot.
 * Coordinates miss and matching fails even where the coordinates are right. Pinning the
 * scale to 1 removes the difference outright rather than measuring a factor and
 * compensating, so it holds at any scale on any machine.
 *
 * Both properties are set: `uiScale` names the factor, and `uiScale.enabled` turns the
 * mechanism off outright, which is the more direct statement of intent and costs nothing.
 */
const UI_SCALE_PROPERTY = '-Dsun.java2d.uiScale';
const UI_SCALE_ARGS = [`${UI_SCALE_PROPERTY}=1`, `${UI_SCALE_PROPERTY}.enabled=false`];

/**
 * The same properties again, for a JVM we do not launch ourselves.
 *
 * The SikuliX IDE jar re-executes java rather than running in the process it was started
 * in, and the replacement inherits the environment but not the command line, so options
 * passed as arguments are silently dropped. Measured, not guessed: a diagnostic report
 * from a scaled Windows display showed `sun.java2d.uiScale` unset inside the JVM that ran
 * the script, while the argument had certainly been passed to the one that was launched.
 * Every JVM reads JAVA_TOOL_OPTIONS out of the environment, so this survives the hand off.
 */
const TOOL_OPTIONS = 'JAVA_TOOL_OPTIONS';

/**
 * Builds the java command line. `-c` routes SikuliX's message area to the console, which
 * is the only reason we see script output at all; `-d` is omitted entirely at level 0,
 * since the option rejects a non-positive argument.
 */
export function buildRunArgs(launch: SikulixLaunch): string[] {
    const jvmArgs = [...(launch.jvmArgs ?? [])];

    // Ours go first, so anyone who sets their own scale deliberately still wins.
    if (!jvmArgs.some(arg => arg.startsWith(UI_SCALE_PROPERTY))) {
        jvmArgs.unshift(...UI_SCALE_ARGS);
    }

    const args = [...jvmArgs, '-jar', launch.jarPath, '-c'];

    if (launch.debugLevel && launch.debugLevel > 0) {
        args.push('-d', String(launch.debugLevel));
    }

    args.push('-r', launch.target);
    return args;
}

/**
 * Runs a Sikuli script, streaming SikuliX's output line by line as it arrives.
 *
 * Spawned rather than buffered: a script can run for minutes and print without bound,
 * so there is no output ceiling and no waiting until exit to see what happened.
 */
export function runSikulixScript(launch: SikulixLaunch, onLine: (line: string) => void): SikulixRun {
    const child = spawn(launch.javaPath, buildRunArgs(launch), {
        cwd: launch.cwd,
        env: launchEnvironment(launch)
    });

    const stdout = new LineSplitter(onLine);
    const stderr = new LineSplitter(onLine);
    child.stdout.on('data', (chunk: Buffer) => stdout.write(chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => stderr.write(chunk.toString()));

    let killTimer: NodeJS.Timeout | undefined;

    const exited = new Promise<number>((resolve, reject) => {
        child.on('error', (err) => {
            clearTimeout(killTimer);
            reject(err);
        });
        child.on('close', (code) => {
            clearTimeout(killTimer);
            stdout.flush();
            stderr.flush();
            resolve(code ?? -1);
        });
    });

    return {
        exited,
        stop: () => {
            if (child.exitCode !== null || child.signalCode !== null) {
                return;
            }

            // Windows has no signals: kill() is an immediate termination of the JVM alone,
            // which strands anything the script started. taskkill takes the tree.
            if (process.platform === 'win32' && child.pid !== undefined) {
                const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true });
                // An unhandled error event here would take the extension host down with it.
                killer.on('error', () => child.kill());
                return;
            }

            child.kill('SIGTERM');
            killTimer = setTimeout(() => child.kill('SIGKILL'), KILL_GRACE_MS);
        }
    };
}

/**
 * The environment for the java process, carrying the scale properties so that a JVM
 * SikuliX starts in place of this one still gets them.
 *
 * An existing JAVA_TOOL_OPTIONS is kept and appended to rather than replaced, since it may
 * be carrying something the user needs. Ours go last, so they win on a repeated property.
 */
export function launchEnvironment(
    launch: SikulixLaunch,
    base: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
    const existing = base[TOOL_OPTIONS];

    // A deliberately chosen scale is left alone here too, wherever it was set.
    const alreadySet = (launch.jvmArgs ?? []).some(arg => arg.startsWith(UI_SCALE_PROPERTY))
        || (existing ?? '').includes('sun.java2d.uiScale');

    if (alreadySet) {
        return { ...base };
    }

    return {
        ...base,
        [TOOL_OPTIONS]: [existing, ...UI_SCALE_ARGS].filter(Boolean).join(' ')
    };
}

/**
 * Reassembles whole lines from arbitrarily chunked stream data.
 */
class LineSplitter {
    private buffer = '';

    constructor(private readonly onLine: (line: string) => void) {}

    write(text: string): void {
        this.buffer += text;

        let newlineIndex: number;
        while ((newlineIndex = this.buffer.indexOf('\n')) !== -1) {
            this.onLine(this.buffer.slice(0, newlineIndex).replace(/\r$/, ''));
            this.buffer = this.buffer.slice(newlineIndex + 1);
        }
    }

    flush(): void {
        if (this.buffer !== '') {
            this.onLine(this.buffer);
            this.buffer = '';
        }
    }
}
