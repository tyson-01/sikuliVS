import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/** A screenshot the agent took, described in screen coordinates. */
export interface CaptureFrame {
    index: number;
    reason: string;
    path: string;
    thumbnail: string | null;
    /** Origin and size of the captured screen, for placing overlays. */
    bounds: { x: number; y: number; w: number; h: number };
}

// Deliberately not "sikulivs-": SikuliX deletes every directory in the system
// temp folder whose name starts with "sikuli" when it shuts down, which would
// take the captures with it, and did, until these were renamed.
const CAPTURE_PREFIX = 'svs-captures-';
const LAUNCH_PREFIX = 'svs-launch-';
const CONSOLE_PREFIX = 'svs-console-';

// How long an abandoned directory has to survive before the sweep takes it. Only
// reached when the editor died without running its own cleanup.
const STALE_AGE_MS = 24 * 60 * 60 * 1000;

const OURS = [CAPTURE_PREFIX, LAUNCH_PREFIX, CONSOLE_PREFIX];

// The previous session's directory, kept alive deliberately. See below.
let pending: string | null = null;

/**
 * Opens a directory for a new session's frames, discarding the last session's
 * first.
 *
 * Captures outlive the session that made them. Deleting them at session end
 * would destroy the evidence exactly when it matters most: a FindFailed aborts
 * the script, the session ends, and the final screenshot, the whole reason to
 * look, would be gone before it could be read. They are dropped once there is
 * a new run to look at instead.
 */
export function beginCaptureSession(): string {
    discardPending();
    return fs.mkdtempSync(path.join(os.tmpdir(), CAPTURE_PREFIX));
}

/** Hands a finished session's directory over to be kept until the next run. */
export function retainAfterSession(directory: string | null): void {
    discardPending();
    pending = directory;
}

/** Drops the kept directory: the panel closed, or the extension is shutting down. */
export function discardPending(): void {
    if (pending) {
        remove(pending);
        pending = null;
    }
}

export function pendingCaptureDir(): string | null {
    return pending;
}

/**
 * Clears out directories a previous editor session abandoned.
 *
 * Nothing removes these when VS Code is killed mid-run, so without a sweep they
 * accumulate in the system temp folder indefinitely. Age-gated so a directory
 * belonging to another window running right now is never taken.
 */
export function sweepStaleTempDirs(root: string = os.tmpdir(), now: number = Date.now()): number {
    let entries: string[];
    try {
        entries = fs.readdirSync(root);
    } catch {
        return 0;
    }

    let swept = 0;
    for (const entry of entries) {
        if (!OURS.some(prefix => entry.startsWith(prefix))) {
            continue;
        }

        const candidate = path.join(root, entry);
        if (candidate === pending) {
            continue;
        }

        try {
            if (now - fs.statSync(candidate).mtimeMs < STALE_AGE_MS) {
                continue;
            }
        } catch {
            continue;
        }

        remove(candidate);
        swept++;
    }
    return swept;
}

function remove(directory: string): void {
    try {
        fs.rmSync(directory, { recursive: true, force: true });
    } catch {
        // A temp directory that will not go is not worth failing anything over.
    }
}
