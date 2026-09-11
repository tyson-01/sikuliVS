import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { log, showError } from '../utils/output';
import { managedStubDir } from '../setup/managedEnvironment';

const STUB_PACKAGE = 'sikuli';
const STUB_FILE = '__init__.pyi';

// Written to both, since the key depends on which language server is installed and this
// should not depend on the user having a particular one.
const PATH_SETTINGS = ['python.analysis.extraPaths', 'python.autoComplete.extraPaths'];

/**
 * Command: sikuliVS.setupCompletion
 * Puts the generated SikuliX API stub where the editor's Python language server will read
 * it, so Region, click and the rest stop being reported as undefined.
 *
 * The stub goes in the extension's own storage rather than the workspace: it is the same
 * file for every project, and copying it in would leave a folder in each one to gitignore.
 * The path it is written to carries no version number, so the setting stays valid across
 * extension upgrades. Running this again refreshes the copy.
 */
export function registerCompletionCommand(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('sikuliVS.setupCompletion', () => setUpCompletion(context, true))
    );
}

/**
 * Installs the stub and points the analysis path at it. Returns false when there was
 * nothing to work on or the user declined.
 *
 * `confirm` is false when this runs as one step of the guided setup, which has already
 * asked; a direct invocation asks for itself.
 */
export async function setUpCompletion(
    context: vscode.ExtensionContext,
    confirm: boolean
): Promise<boolean> {
    try {
        const folder = targetFolder();
        if (!folder) {
            vscode.window.showWarningMessage(
                'SikuliVS: Open a folder first, so the analysis path has somewhere to be set.'
            );
            return false;
        }

        const source = path.join(context.extensionPath, 'stubs', STUB_PACKAGE, STUB_FILE);
        if (!fs.existsSync(source)) {
            await showError(`SikuliVS: The bundled API stub is missing from ${source}.`);
            return false;
        }

        if (confirm && !(await confirmWith(folder))) {
            return false;
        }

        const destination = path.join(managedStubDir(context), STUB_PACKAGE, STUB_FILE);
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.copyFileSync(source, destination);
        log(`[completion] stub written to ${destination}`);

        const applied = await applyPathSettings(folder, managedStubDir(context));
        await report(applied, destination);
        return applied.length > 0;

    } catch (err) {
        await showError(`SikuliVS: Could not set up script completion (${err}).`);
        return false;
    }
}

/** Whether this workspace already resolves the stub. */
export function completionIsSetUp(context: vscode.ExtensionContext): boolean {
    const folder = targetFolder();
    if (!folder || !fs.existsSync(path.join(managedStubDir(context), STUB_PACKAGE, STUB_FILE))) {
        return false;
    }

    const stubDir = managedStubDir(context);
    return PATH_SETTINGS.some((setting) => {
        const lastDot = setting.lastIndexOf('.');
        const config = vscode.workspace.getConfiguration(setting.slice(0, lastDot), folder.uri);
        return config.get<string[]>(setting.slice(lastDot + 1), []).includes(stubDir);
    });
}

/**
 * The folder holding the script being worked on, else the only one there is.
 */
function targetFolder(): vscode.WorkspaceFolder | undefined {
    const active = vscode.window.activeTextEditor?.document.uri;
    return (active ? vscode.workspace.getWorkspaceFolder(active) : undefined)
        ?? vscode.workspace.workspaceFolders?.[0];
}

async function confirmWith(folder: vscode.WorkspaceFolder): Promise<boolean> {
    const choice = await vscode.window.showInformationMessage(
        `SikuliVS: This adds the SikuliX API stub to ${PATH_SETTINGS.join(' and ')} in ` +
        `"${folder.name}" settings. The stub itself lives in the extension's own storage, so ` +
        'nothing is written into your project.',
        { modal: true },
        'Set It Up'
    );
    return choice === 'Set It Up';
}

/**
 * Adds the stub folder to each path setting, leaving whatever is already there alone.
 * Returns the settings that took the change; one can fail because the key only exists
 * when the language server contributing it is installed.
 */
async function applyPathSettings(
    folder: vscode.WorkspaceFolder,
    stubDir: string
): Promise<string[]> {
    const applied: string[] = [];

    for (const setting of PATH_SETTINGS) {
        const lastDot = setting.lastIndexOf('.');
        const section = setting.slice(0, lastDot);
        const key = setting.slice(lastDot + 1);

        const config = vscode.workspace.getConfiguration(section, folder.uri);
        const current = config.get<string[]>(key, []);
        if (current.includes(stubDir)) {
            applied.push(setting);
            continue;
        }

        try {
            await config.update(key, [...current, stubDir], vscode.ConfigurationTarget.Workspace);
            applied.push(setting);
        } catch {
            // The key is not registered, so no language server here reads it.
            log(`[completion] ${setting} could not be set; no extension contributes it`);
        }
    }

    return applied;
}

async function report(applied: string[], destination: string): Promise<void> {
    if (applied.length === 0) {
        await showError(
            `SikuliVS: The stub was written to ${destination}, but neither ` +
            `${PATH_SETTINGS.join(' nor ')} could be set, so no Python language server is ` +
            'installed to read it. Install a Python extension and run this again.'
        );
        return;
    }

    const choice = await vscode.window.showInformationMessage(
        'SikuliVS: Script completion is set up. Add "from sikuli import *" to a script, then ' +
        'reload the window if the warnings are still there.',
        'Reload Window'
    );
    if (choice === 'Reload Window') {
        await vscode.commands.executeCommand('workbench.action.reloadWindow');
    }
}
