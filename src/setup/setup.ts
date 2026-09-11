import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { log, showError } from '../utils/output';
import { isBundleDir } from '../utils/scriptTarget';
import { setUpCompletion, completionIsSetUp } from '../commands/completion';
import {
    createManagedEnvironment,
    hasManagedInterpreter,
    missingModuleAdvice
} from './managedEnvironment';

const EXTENSION_ID = 'tyson-01.sikulivs';

// Asked once per workspace. Declining is remembered so the offer is not a recurring
// interruption; the command stays in the palette afterwards.
const OFFERED_KEY = 'sikuliVS.setupOffered';

/**
 * Command: sikuliVS.setup
 * Walks the three things the extension cannot supply for itself: the SikuliX jar, a Python
 * with the imaging libraries, and the API stub for the editor.
 *
 * Each is optional and serves a different feature, so each step says what it is for and
 * can be skipped. Nothing is installed or written without being asked first.
 */
export function registerSetup(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('sikuliVS.setup', () => runSetup(context))
    );

    watchForFirstScript(context);
}

/**
 * Waits for a Sikuli script to be in front of the user, then offers setup once.
 *
 * Not checked during activation: `activeTextEditor` is routinely still unset while a window
 * restores its editors, so asking then decides against offering before there is anything to
 * look at. Watching instead means the offer arrives whether the script was already open or
 * gets opened later, and the listener drops itself afterwards.
 */
function watchForFirstScript(context: vscode.ExtensionContext): void {
    if (context.workspaceState.get<boolean>(OFFERED_KEY)) {
        return;
    }

    if (isSikuliScript(vscode.window.activeTextEditor?.document)) {
        void offerOnce(context);
        return;
    }

    const listener = vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (!isSikuliScript(editor?.document)) {
            return;
        }
        listener.dispose();
        void offerOnce(context);
    });
    context.subscriptions.push(listener);
}

/**
 * Offers setup the first time a Sikuli script is opened, the way the jar is asked for
 * rather than configured by hand.
 */
async function offerOnce(context: vscode.ExtensionContext): Promise<void> {
    if (context.workspaceState.get<boolean>(OFFERED_KEY)) {
        return;
    }

    // Nothing to offer when everything is already in place.
    if (jarIsSet() && hasManagedInterpreter(context) && completionIsSetUp(context)) {
        return;
    }

    const choice = await vscode.window.showInformationMessage(
        'SikuliVS needs a SikuliX jar to run scripts, and Python with a few imaging ' +
        'libraries for the visual tools. Set them up now?',
        'Set Up',
        'Later',
        'Setup Help'
    );

    if (choice === 'Setup Help') {
        await openExtensionPage();
        return;     // Deliberately not marked as offered: they have not decided yet.
    }

    await context.workspaceState.update(OFFERED_KEY, true);

    if (choice === 'Set Up') {
        await runSetup(context);
    }
}

async function runSetup(context: vscode.ExtensionContext): Promise<void> {
    await context.workspaceState.update(OFFERED_KEY, true);

    const done: string[] = [];
    const skipped: string[] = [];

    (await setUpJar() ? done : skipped).push('SikuliX jar');
    (await setUpPython(context) ? done : skipped).push('Python environment');
    (await setUpStub(context) ? done : skipped).push('script completion');

    const parts = [
        done.length > 0 ? `Ready: ${done.join(', ')}.` : '',
        skipped.length > 0 ? `Still to do: ${skipped.join(', ')}.` : ''
    ].filter(Boolean);

    const choice = await vscode.window.showInformationMessage(
        `SikuliVS setup. ${parts.join(' ')}`,
        'Setup Help'
    );
    if (choice === 'Setup Help') {
        await openExtensionPage();
    }
}

/**
 * Whether this is Sikuli work rather than any Python at all.
 *
 * The extension activates on every Python file, and an unprompted notification in someone
 * else's Django project would be noise. A script inside a `.sikuli` bundle is unambiguous.
 * Anyone outside one still meets the jar prompt on their first run and the environment
 * prompt on their first visual tool, so a missed offer costs nothing.
 */
function isSikuliScript(document: vscode.TextDocument | undefined): boolean {
    return document?.languageId === 'python'
        && isBundleDir(path.dirname(document.uri.fsPath));
}

function jarIsSet(): boolean {
    const configured = vscode.workspace.getConfiguration('sikuliVS').get<string>('jarPath', '').trim();
    return configured !== '' && fs.existsSync(configured);
}

/**
 * Asks for the jar, which the extension cannot download: SikuliX publishes a different
 * build per platform and the API one is the right one.
 */
async function setUpJar(): Promise<boolean> {
    if (jarIsSet()) {
        return true;
    }

    const choice = await vscode.window.showInformationMessage(
        'SikuliVS: Running scripts needs the SikuliX API jar, sikulixapi-<version>-<platform>.jar. ' +
        'It is not bundled, since each platform has its own build.',
        'Select Jar...',
        'Skip'
    );
    if (choice !== 'Select Jar...') {
        return false;
    }

    const picked = await vscode.window.showOpenDialog({
        canSelectMany: false,
        openLabel: 'Use this jar',
        filters: { 'Java archive': ['jar'] }
    });
    if (!picked || picked.length === 0) {
        return false;
    }

    await vscode.workspace.getConfiguration('sikuliVS').update(
        'jarPath', picked[0].fsPath, vscode.ConfigurationTarget.Global
    );
    log(`[setup] jar set to ${picked[0].fsPath}`);
    return true;
}

/**
 * Offers to build the managed virtualenv, which is what the visual tools run on.
 */
async function setUpPython(context: vscode.ExtensionContext): Promise<boolean> {
    if (hasManagedInterpreter(context)) {
        return true;
    }

    const choice = await vscode.window.showInformationMessage(
        'SikuliVS: The visual tools (region, location, capture, offset, match) need Python with ' +
        'opencv, numpy and pillow. One can be created now in the extension\'s own storage, ' +
        'leaving your system Python untouched.',
        'Create It',
        'Skip'
    );
    if (choice !== 'Create It') {
        return false;
    }

    return installPythonEnvironment(context);
}

/**
 * Builds the environment with progress, and reports what pip could not finish.
 * Separated so the visual tools can offer the same thing when they find no interpreter.
 */
export async function installPythonEnvironment(context: vscode.ExtensionContext): Promise<boolean> {
    try {
        const result = await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: 'SikuliVS: building the Python environment',
                cancellable: false
            },
            (progress) => createManagedEnvironment(context, progress)
        );

        if (result.missing.length > 0) {
            await showError(`SikuliVS: ${missingModuleAdvice(result.missing)}`);
            return false;
        }

        void vscode.window.showInformationMessage(
            'SikuliVS: The Python environment is ready. The visual tools will use it automatically.'
        );
        return true;

    } catch (err) {
        await showError(`SikuliVS: Could not build the Python environment. ${err}`);
        return false;
    }
}

async function setUpStub(context: vscode.ExtensionContext): Promise<boolean> {
    if (completionIsSetUp(context)) {
        return true;
    }

    const choice = await vscode.window.showInformationMessage(
        'SikuliVS: SikuliX gives a script its API without an import, so the editor reports ' +
        'Region and click as undefined. A stub fixes that, and needs "from sikuli import *" ' +
        'at the top of a script.',
        'Set It Up',
        'Skip'
    );
    if (choice !== 'Set It Up') {
        return false;
    }

    return setUpCompletion(context, false);
}

/**
 * Opens the extension's own page, which renders the README. A notification cannot carry a
 * link, so this is what a "read the docs" action looks like in an editor.
 */
async function openExtensionPage(): Promise<void> {
    try {
        await vscode.commands.executeCommand('extension.open', EXTENSION_ID);
    } catch {
        await vscode.commands.executeCommand(
            'workbench.extensions.search', EXTENSION_ID
        );
    }
}
