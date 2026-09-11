import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { log } from '../utils/output';
import { venvBin } from '../utils/platform';

/**
 * The folder the extension owns for things it installs on the user's behalf.
 *
 * `globalStorageUri` rather than a temp folder or the extension directory. A temp folder
 * is wiped, and this holds a few hundred megabytes of wheels that would have to be
 * downloaded again. The extension directory carries the version number in its path, so
 * every upgrade would orphan whatever was put there, along with any setting pointing at
 * it. This path has no version in it and survives upgrades.
 *
 * Nothing here is ever deleted by the extension during normal use. VS Code removes the
 * whole folder when the extension is uninstalled, which is the lifecycle that matches
 * "things the extension installed for itself".
 */
export function managedRoot(context: vscode.ExtensionContext): string {
    return context.globalStorageUri.fsPath;
}

export function managedVenvDir(context: vscode.ExtensionContext): string {
    return path.join(managedRoot(context), 'venv');
}

export function managedStubDir(context: vscode.ExtensionContext): string {
    return path.join(managedRoot(context), 'stubs');
}

/** The interpreter inside the managed virtualenv, whether or not it exists yet. */
export function managedInterpreter(context: vscode.ExtensionContext): string {
    return path.join(managedVenvDir(context), venvBin());
}

export function hasManagedInterpreter(context: vscode.ExtensionContext): boolean {
    return fs.existsSync(managedInterpreter(context));
}

// Interpreters to build the virtualenv from. `py` is the Windows launcher, which is
// present even when `python` is the App Store stub.
const BASE_CANDIDATES = process.platform === 'win32'
    ? [['py', ['-3']], ['python', []]] as const
    : [['python3', []], ['python', []]] as const;

const VENV_TIMEOUT_MS = 120000;
const PIP_TIMEOUT_MS = 600000;

// tkinter is the one requirement pip cannot supply: it is a system package on the Linux
// distributions, and bundled with the Windows and python.org installers.
const TKINTER_PACKAGES: Record<string, string> = {
    debian: 'python3-tk',
    fedora: 'python3-tkinter'
};

export interface EnvironmentResult {
    interpreter: string;
    /** Modules still missing afterwards, which on Linux usually means tkinter. */
    missing: string[];
}

/**
 * Creates the managed virtualenv and installs requirements.txt into it.
 *
 * Throws with a message worth showing when the environment cannot be built at all.
 * Succeeds with `missing` populated when it was built but is still short something pip
 * cannot provide, which the caller has to report rather than treat as success.
 */
export async function createManagedEnvironment(
    context: vscode.ExtensionContext,
    progress?: vscode.Progress<{ message?: string }>
): Promise<EnvironmentResult> {
    const requirements = path.join(context.extensionPath, 'requirements.txt');
    if (!fs.existsSync(requirements)) {
        throw new Error(`the bundled requirements.txt is missing from ${context.extensionPath}`);
    }

    const venvDir = managedVenvDir(context);
    fs.mkdirSync(managedRoot(context), { recursive: true });

    // A previous attempt that died midway leaves a venv that cannot be installed into.
    if (fs.existsSync(venvDir)) {
        fs.rmSync(venvDir, { recursive: true, force: true });
    }

    progress?.report({ message: 'creating the virtual environment...' });
    await createVenv(venvDir);

    const interpreter = managedInterpreter(context);
    if (!fs.existsSync(interpreter)) {
        throw new Error(`the virtual environment was created without an interpreter at ${interpreter}`);
    }

    progress?.report({ message: 'installing opencv, numpy and pillow...' });
    await pipInstall(interpreter, requirements);

    log(`[setup] managed environment ready at ${interpreter}`);
    return { interpreter, missing: await stillMissing(interpreter) };
}

/**
 * Builds the virtualenv with the first base interpreter that manages it.
 *
 * `venv` being importable is not assumed: the Debian family ships it as a separate
 * package, so a failure here is reported with that named rather than as a bare exit code.
 */
async function createVenv(venvDir: string): Promise<void> {
    const attempts: string[] = [];

    for (const [command, prefix] of BASE_CANDIDATES) {
        try {
            await exec(command, [...prefix, '-m', 'venv', venvDir], VENV_TIMEOUT_MS);
            log(`[setup] built the virtual environment with ${command}`);
            return;
        } catch (err) {
            attempts.push(`${command}: ${err}`);
        }
    }

    throw new Error(
        'no Python could build a virtual environment. Install Python 3, and on Debian or ' +
        `Ubuntu the separate python3-venv package. Tried: ${attempts.join('; ')}`
    );
}

async function pipInstall(interpreter: string, requirements: string): Promise<void> {
    try {
        await exec(
            interpreter,
            ['-m', 'pip', 'install', '--disable-pip-version-check', '-r', requirements],
            PIP_TIMEOUT_MS
        );
    } catch (err) {
        throw new Error(`pip could not install the requirements: ${err}`);
    }
}

/**
 * What the finished environment still cannot import. Empty is the good case.
 */
async function stillMissing(interpreter: string): Promise<string[]> {
    const modules = ['cv2', 'numpy', 'PIL', 'tkinter'];
    const probe = modules
        .map(module => `try:\n import ${module}\nexcept Exception:\n print("${module}")\n`)
        .join('');

    try {
        const stdout = await exec(interpreter, ['-c', probe], VENV_TIMEOUT_MS);
        return stdout.split('\n').map(line => line.trim()).filter(Boolean);
    } catch {
        return modules;
    }
}

/**
 * How to finish the job by hand, for the modules pip cannot install.
 */
export function missingModuleAdvice(missing: string[]): string {
    if (!missing.includes('tkinter')) {
        return `The environment is still missing ${missing.join(', ')}.`;
    }

    const packages = Object.values(TKINTER_PACKAGES).join(' or ');
    return (
        'The environment was created, but tkinter is missing and pip cannot supply it: it is ' +
        `a system package. Install ${packages} with your package manager, then try again.`
    );
}

function exec(command: string, args: string[], timeout: number): Promise<string> {
    return new Promise((resolve, reject) => {
        execFile(command, args, { timeout }, (error, stdout, stderr) => {
            if (error) {
                return reject(new Error((stderr || stdout || error.message).trim().split('\n')[0]));
            }
            resolve(stdout);
        });
    });
}
