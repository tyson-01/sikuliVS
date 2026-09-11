import * as vscode from 'vscode';
import { execFile } from 'child_process';
import * as path from 'path';
import { log } from '../utils/output';
import { NoPythonError, resolvePythonPath } from '../utils/pythonConfig';
import { installPythonEnvironment } from '../setup/setup';

let extensionContext: vscode.ExtensionContext | null = null;

/** Lets the bridge offer to build an environment when there is none to run. */
export function registerGuiContext(context: vscode.ExtensionContext): void {
    extensionContext = context;
}

/**
 * Executes the background Python GUI sidecar process and awaits its stdout.
 * Resolves null when the tool exits cleanly with no output, which is how the GUIs
 * signal a cancel. Rejects only on failure.
 */
export async function runPythonGui(action: string, args: string[] = []): Promise<string | null> {
    const rootDir = path.join(__dirname, '../../');
    const scriptPath = path.join(rootDir, 'python_gui/main.py');
    const pythonPath = await resolveOrOffer(rootDir);

    const argv = [scriptPath, '--action', action, ...args];

    return new Promise((resolve, reject) => {
        execFile(pythonPath, argv, { cwd: rootDir }, (error, stdout, stderr) => {
            if (stderr) {
                log(`[${action}]\n${stderr.trimEnd()}`);
            }

            if (error) {
                return reject(new Error(stderr.trim() || error.message));
            }

            const output = stdout.trim();
            resolve(output === '' ? null : output);
        });
    });
}

/**
 * The interpreter, offering to build one when the machine has none that will do.
 *
 * A tool that fails because nothing is installed is the natural moment to ask, rather than
 * sending the user off to read about virtualenvs. Asked once per attempt, never silent, and
 * the original error is raised unchanged if they decline, so nothing is hidden.
 */
async function resolveOrOffer(rootDir: string): Promise<string> {
    try {
        return await resolvePythonPath(rootDir);
    } catch (err) {
        if (!(err instanceof NoPythonError) || !extensionContext) {
            throw err;
        }

        const choice = await vscode.window.showErrorMessage(
            'SikuliVS: The visual tools need Python with opencv, numpy and pillow, and none was ' +
            'found. One can be created in the extension\'s own storage, leaving your system ' +
            'Python untouched.',
            'Create It'
        );
        if (choice !== 'Create It' || !(await installPythonEnvironment(extensionContext))) {
            throw err;
        }

        return resolvePythonPath(rootDir);
    }
}
