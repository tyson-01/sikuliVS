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
 * Builds the java command line. `-c` routes SikuliX's message area to the console, which
 * is the only reason we see script output at all; `-d` is omitted entirely at level 0,
 * since the option rejects a non-positive argument.
 */
export function buildRunArgs(launch: SikulixLaunch): string[] {
    const args = [...(launch.jvmArgs ?? []), '-jar', launch.jarPath, '-c'];

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
    const child = spawn(launch.javaPath, buildRunArgs(launch), { cwd: launch.cwd });

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
            child.kill('SIGTERM');
            killTimer = setTimeout(() => child.kill('SIGKILL'), KILL_GRACE_MS);
        }
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
