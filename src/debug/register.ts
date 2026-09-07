import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
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
        ),

        vscode.commands.registerCommand('sikuliVS.debugHighlight', (context?: VariableContext) =>
            highlightVariable(context)
        ),

        vscode.commands.registerCommand('sikuliVS.debugCopyRegion', (context?: VariableContext) =>
            copyAsRegion(context)
        ),

        vscode.commands.registerCommand('sikuliVS.console', openConsole)
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


/** What VS Code hands a command invoked from the VARIABLES pane. */
interface VariableContext {
    variable?: { name?: string; value?: string; evaluateName?: string };
}

function evaluableName(context?: VariableContext): string | null {
    const name = context?.variable?.evaluateName;
    if (!name) {
        void vscode.window.showWarningMessage(
            'SikuliVS: That value cannot be reached by an expression.'
        );
        return null;
    }
    return name;
}

/** Outlines the selected Region or Match on the real screen. */
async function highlightVariable(context?: VariableContext): Promise<void> {
    const session = vscode.debug.activeDebugSession;
    const expression = evaluableName(context);
    if (!session || !expression) {
        return;
    }

    try {
        await session.customRequest('sikulivsHighlight', { expression, seconds: 2 });
    } catch (err) {
        void vscode.window.showWarningMessage(`SikuliVS: Could not highlight it (${err}).`);
    }
}

/**
 * Copies the selected region as source, so a region found at runtime can be
 * pasted straight into the script.
 */
async function copyAsRegion(context?: VariableContext): Promise<void> {
    const session = vscode.debug.activeDebugSession;
    const expression = evaluableName(context);
    if (!session || !expression) {
        return;
    }

    try {
        const parts = await Promise.all(['getX()', 'getY()', 'getW()', 'getH()'].map(
            accessor => session.customRequest('evaluate', {
                expression: `${expression}.${accessor}`,
                context: 'repl'
            })
        ));

        const source = `Region(${parts.map(part => part.result).join(', ')})`;
        await vscode.env.clipboard.writeText(source);
        void vscode.window.showInformationMessage(`SikuliVS: Copied ${source}`);
    } catch (err) {
        void vscode.window.showWarningMessage(`SikuliVS: Could not read its bounds (${err}).`);
    }
}

/**
 * Command: sikuliVS.console
 * Opens a live SikuliX interpreter with no script to write first. It is an
 * ordinary debug session on a throwaway stub that stops on its first line, so
 * the Debug Console is sitting in a fully initialised SikuliX namespace: type
 * `exists("button.png")` and watch it search the real screen.
 */
async function openConsole(): Promise<void> {
    const document = vscode.window.activeTextEditor?.document;
    const bundle = document && document.languageId === 'python'
        ? path.dirname(document.uri.fsPath)
        : vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    if (!bundle) {
        vscode.window.showWarningMessage(
            'SikuliVS: Open a script or a folder first, so images have somewhere to resolve from.'
        );
        return;
    }

    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'svs-console-'));
    const stub = path.join(directory, 'sikulivs_console.py');
    fs.writeFileSync(stub, CONSOLE_STUB, 'utf8');

    await vscode.debug.startDebugging(undefined, {
        type: DEBUG_TYPE,
        request: 'launch',
        name: 'SikuliX: Console',
        program: stub,
        stopOnEntry: true,
        bundle,
        consoleStub: stub
    });
}

// One executable line is all it takes: the session stops on it, and everything
// typed into the Debug Console runs in SikuliX's own namespace from there.
const CONSOLE_STUB = [
    '# -*- coding: utf-8 -*-',
    '# SikuliVS interactive console. The session stops here; use the DEBUG CONSOLE',
    '# to run anything against the live screen. Continuing ends the session.',
    'pass',
    ''
].join('\n');
