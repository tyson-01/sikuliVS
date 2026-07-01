import { exec } from 'child_process';
import * as path from 'path';

export interface GuiResponse {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    path?: string;
}

export function runPythonGui(action: string, extraArgs: string[] = []): Promise<string> {
    return new Promise((resolve, reject) => {
        const rootDir = path.join(__dirname, '../../');
        const scriptPath = path.join(rootDir, 'python_gui/main.py');
        const pythonPath = path.join(rootDir, '.venv/bin/python3');
        
        // Combine action and any incoming extra arguments securely
        const argsList = [`--action ${action}`, ...extraArgs];
        const args = argsList.join(' ');
        
        exec(`"${pythonPath}" "${scriptPath}" ${args}`, (error, stdout, stderr) => {
            // PIPELINE LOGS FOR TRACKING DOWN BACKEND BUG:
            if (stderr) {
                console.log(`[Python Backtrace / Logs]:\n${stderr}`);
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