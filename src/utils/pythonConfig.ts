import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { log } from './output';
import { pythonCommand, venvBin } from './platform';

// What python_gui needs beyond the standard library, plus tkinter, which the
// Debian family packages separately from python3 itself.
const REQUIRED_MODULES = ['cv2', 'numpy', 'PIL', 'tkinter'];

const VENV_BIN = venvBin();

// A candidate that neither answers nor fails is possible: Windows ships an App Store
// stub at python.exe on machines with no Python, and a probe of it can sit forever.
const PROBE_TIMEOUT_MS = 15000;

let resolved: string | null = null;
let resolvedFor: string | null = null;

// The virtualenv the extension built for itself, if setup ever made one. Registered at
// activation rather than passed in, because the visual tools reach the resolver through a
// bridge that has no access to the extension context.
let managedVenv: string | null = null;

export function registerManagedVenv(interpreter: string): void {
    managedVenv = interpreter;
}

/** True when resolution failed for want of any interpreter, rather than a bad setting. */
export class NoPythonError extends Error {}

/**
 * Finds a Python that can actually run the visual tools.
 * Throws with guidance when nothing works; callers already report errors.
 */
export async function resolvePythonPath(extensionRoot: string): Promise<string> {
    const configured = vscode.workspace.getConfiguration('sikuliVS').get<string>('pythonPath', '').trim();

    if (resolved && resolvedFor === configured) {
        return resolved;
    }

    const candidates = configured ? [configured] : discoverCandidates(extensionRoot);
    const rejected: string[] = [];

    for (const candidate of candidates) {
        const missing = await missingModules(candidate);
        if (missing === null) {
            rejected.push(`${candidate} (not runnable)`);
            continue;
        }
        if (missing.length > 0) {
            rejected.push(`${candidate} (missing ${missing.join(', ')})`);
            continue;
        }

        log(`[tools] python: ${candidate}`);
        resolved = candidate;
        resolvedFor = configured;
        return candidate;
    }

    const message = buildFailureMessage(rejected, Boolean(configured));
    throw configured ? new Error(message) : new NoPythonError(message);
}

/**
 * The virtualenv beside the extension first, since that is what a cloned checkout builds,
 * then one in the user's own workspace, then whatever `python3` means here.
 */
function discoverCandidates(extensionRoot: string): string[] {
    const candidates = [path.join(extensionRoot, '.venv', VENV_BIN)];

    // Before the user's own environments, since this one was built to these requirements.
    if (managedVenv) {
        candidates.push(managedVenv);
    }

    for (const folder of vscode.workspace.workspaceFolders ?? []) {
        candidates.push(path.join(folder.uri.fsPath, '.venv', VENV_BIN));
    }

    candidates.push(pythonCommand());

    // A bare interpreter name has to stay in the list; only real paths can be checked.
    return candidates.filter(
        (candidate, index) =>
            candidates.indexOf(candidate) === index &&
            (!path.isAbsolute(candidate) || fs.existsSync(candidate))
    );
}

/**
 * Returns the modules the interpreter cannot import, an empty array when it has them all,
 * or null when it cannot be run at all.
 */
function missingModules(pythonPath: string): Promise<string[] | null> {
    const probe = REQUIRED_MODULES
        .map(module => `try:\n import ${module}\nexcept Exception:\n print("${module}")\n`)
        .join('');

    return new Promise((resolve) => {
        execFile(pythonPath, ['-c', probe], { timeout: PROBE_TIMEOUT_MS }, (error, stdout) => {
            if (error && !stdout) {
                return resolve(null);
            }
            resolve(stdout.split('\n').map(line => line.trim()).filter(Boolean));
        });
    });
}

// The tools are launched directly rather than through a shell, which cannot start a
// batch file, so a wrapper is worth naming as the cause rather than leaving as EINVAL.
const WRAPPER_NOTE = 'The setting must name a Python executable itself, not a .cmd or .bat wrapper.';

function buildFailureMessage(rejected: string[], wasConfigured: boolean): string {
    const tried = rejected.length > 0 ? ` Tried: ${rejected.join('; ')}.` : '';

    if (wasConfigured) {
        return `SikuliVS: sikuliVS.pythonPath cannot run the visual tools.${tried} ${WRAPPER_NOTE}`;
    }

    return (
        'SikuliVS: No Python with the required modules was found, so the visual tools ' +
        `cannot run.${tried} Create a virtualenv, install requirements.txt into it, and ` +
        `set sikuliVS.pythonPath to its interpreter. ${WRAPPER_NOTE}`
    );
}
