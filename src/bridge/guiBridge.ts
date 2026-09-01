import { execFile } from 'child_process';
import * as path from 'path';
import { log } from '../utils/output';

/**
 * Executes the background Python GUI sidecar process and awaits its stdout.
 * Resolves null when the tool exits cleanly with no output, which is how the GUIs
 * signal a cancel. Rejects only on failure.
 */
export function runPythonGui(action: string, args: string[] = []): Promise<string | null> {
    return new Promise((resolve, reject) => {
        const rootDir = path.join(__dirname, '../../');
        const scriptPath = path.join(rootDir, 'python_gui/main.py');
        const pythonPath = path.join(rootDir, '.venv/bin/python3');

        const argv = [scriptPath, '--action', action, ...args];

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
