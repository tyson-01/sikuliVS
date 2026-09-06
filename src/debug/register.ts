import * as vscode from 'vscode';
import { SikulixDebugSession } from './session';

export const DEBUG_TYPE = 'sikulivs';

/**
 * Wires up the debugger: the adapter itself, a configuration that works without a
 * launch.json, and the toolbar command that starts a session for the open script.
 */
export function registerDebugging(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.debug.registerDebugAdapterDescriptorFactory(DEBUG_TYPE, {
            createDebugAdapterDescriptor: () => new vscode.DebugAdapterInlineImplementation(
                new SikulixDebugSession(context.extensionPath)
            )
        }),

        vscode.debug.registerDebugConfigurationProvider(DEBUG_TYPE, {
            resolveDebugConfiguration: (_folder, config) => resolveConfiguration(config)
        }),

        vscode.commands.registerCommand('sikuliVS.debugScript', (resource?: vscode.Uri) =>
            debugScript(resource)
        )
    );
}

/**
 * Fills in a configuration launched with F5 and no launch.json, where VS Code hands over
 * an empty object and expects the adapter to work out what to run.
 */
function resolveConfiguration(
    config: vscode.DebugConfiguration
): vscode.DebugConfiguration | undefined {
    if (config.program) {
        return config;
    }

    const document = vscode.window.activeTextEditor?.document;
    if (!document || document.languageId !== 'python') {
        void vscode.window.showWarningMessage(
            'SikuliVS: Open the Python script you want to debug first.'
        );
        return undefined;
    }

    return {
        type: DEBUG_TYPE,
        request: 'launch',
        name: 'SikuliX: Debug Script',
        program: document.uri.fsPath,
        stopOnEntry: config.stopOnEntry === true
    };
}

async function debugScript(resource?: vscode.Uri): Promise<void> {
    const document = resource
        ? await vscode.workspace.openTextDocument(resource)
        : vscode.window.activeTextEditor?.document;

    if (!document) {
        vscode.window.showWarningMessage('SikuliVS: No active text editor open.');
        return;
    }

    if (document.languageId !== 'python') {
        vscode.window.showWarningMessage('SikuliVS: Only Python (Jython) scripts can be debugged.');
        return;
    }

    await document.save();

    await vscode.debug.startDebugging(
        vscode.workspace.getWorkspaceFolder(document.uri),
        {
            type: DEBUG_TYPE,
            request: 'launch',
            name: 'SikuliX: Debug Script',
            program: document.uri.fsPath,
            stopOnEntry: false
        }
    );
}
