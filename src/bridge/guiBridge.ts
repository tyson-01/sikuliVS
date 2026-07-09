import { exec } from 'child_process';
import * as path from 'path';

export interface GuiResponse {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    path?: string;
}

/**
 * Executes the background Python GUI sidecar process, passes operational flags, 
 * and awaits stdout string data responses.
 */
export function runPythonGui(action: string, extraArgs: string[] = []): Promise<string> {
    return new Promise((resolve, reject) => {
        const rootDir = path.join(__dirname, '../../');
        const scriptPath = path.join(rootDir, 'python_gui/main.py');
        const pythonPath = path.join(rootDir, '.venv/bin/python3');
        
        // Combine action and incoming extra arguments with spaces so the shell parses them correctly
        const argsList = [`--action ${action}`, ...extraArgs];
        const args = argsList.join(' ');
        
        exec(`"${pythonPath}" "${scriptPath}" ${args}`, (error, stdout, stderr) => {
            if (stderr) {
                console.warn(`[Python Backtrace / Logs]:\n${stderr}`);
            }

            if (error) {
                return reject(stderr.trim() || 'Process closed or cancelled.');
            }

            const output = stdout.trim();
            if (!output) {
                return reject('Cancelled');
            }

            resolve(output);
        });
    });
}