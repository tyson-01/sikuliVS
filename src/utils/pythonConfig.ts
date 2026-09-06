import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { log } from './output';

// What python_gui needs beyond the standard library, plus tkinter, which the
// Debian family packages separately from python3 itself.
const REQUIRED_MODULES = ['cv2', 'numpy', 'PIL', 'tkinter', 'dbus_fast'];

const VENV_BIN = process.platform === 'win32'
    ? path.join('Scripts', 'python.exe')
    : path.join('bin', 'python3');

let resolved: string | null = null;
let resolvedFor: string | null = null;

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

    throw new Error(buildFailureMessage(rejected, Boolean(configured)));
}

/**
 * The virtualenv beside the extension first, since that is what a cloned checkout builds,
 * then one in the user's own workspace, then whatever `python3` means here.
 */
function discoverCandidates(extensionRoot: string): string[] {
    const candidates = [path.join(extensionRoot, '.venv', VENV_BIN)];

    for (const folder of vscode.workspace.workspaceFolders ?? []) {
        candidates.push(path.join(folder.uri.fsPath, '.venv', VENV_BIN));
    }

    candidates.push(process.platform === 'win32' ? 'python' : 'python3');

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
        execFile(pythonPath, ['-c', probe], (error, stdout) => {
            if (error && !stdout) {
                return resolve(null);
            }
            resolve(stdout.split('\n').map(line => line.trim()).filter(Boolean));
        });
    });
}

function buildFailureMessage(rejected: string[], wasConfigured: boolean): string {
    const tried = rejected.length > 0 ? ` Tried: ${rejected.join('; ')}.` : '';

    if (wasConfigured) {
        return `SikuliVS: sikuliVS.pythonPath cannot run the visual tools.${tried}`;
    }

    return (
        'SikuliVS: No Python with the required modules was found, so the visual tools ' +
        `cannot run.${tried} Create a virtualenv, install requirements.txt into it, and ` +
        'set sikuliVS.pythonPath to its interpreter.'
    );
}
