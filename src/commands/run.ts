import * as vscode from 'vscode';
import { runSikulixScript, SikulixRun } from '../bridge/sikulixBridge';
import { resolveEnvironment, confirmDisplayServer } from '../utils/sikulixConfig';
import { resolveScriptTarget } from '../utils/scriptTarget';
import { ScriptErrorParser } from '../utils/runErrors';
import { clearRunDiagnostics, publishScriptDiagnostics } from '../utils/runDiagnostics';
import { log, showError, showInfo } from '../utils/output';
import { acquireRun, releaseRun, runHolder } from '../utils/runLock';

// Drives the play/stop swap on the editor title button.
const RUNNING_CONTEXT = 'sikuliVS.running';

let activeRun: SikulixRun | null = null;
let stopRequested = false;

/**
 * Commands: sikuliVS.runScript / sikuliVS.stopScript
 * Hands the enclosing `.sikuli` bundle to SikuliX and streams its output into the
 * SikuliVS channel, turning a reported error line into a diagnostic on the script.
 */
export function registerRunCommands(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('sikuliVS.runScript', (resource?: vscode.Uri) =>
            runScript(resource)
        ),
        vscode.commands.registerCommand('sikuliVS.stopScript', stopScript)
    );
}

async function runScript(resource?: vscode.Uri): Promise<void> {
    // Guards the whole launch, not just the spawn: resolving the script and its environment
    // awaits, and a second click must not slip past in the meantime.
    if (!acquireRun('run')) {
        vscode.window.showWarningMessage(
            `SikuliVS: A script is already ${runHolder() === 'debug' ? 'being debugged' : 'running'}.`
        );
        return;
    }

    try {
        const document = await resolveDocument(resource);
        if (!document) {
            return;
        }

        await document.save();

        const script = resolveScriptTarget(document.uri.fsPath);
        const environment = await resolveEnvironment();
        if (!environment) {
            return;
        }

        if (!(await confirmDisplayServer())) {
            return;
        }

        clearRunDiagnostics();
        await setRunning(true);

        const parser = new ScriptErrorParser();
        log(`[run] ${script.target}`);

        stopRequested = false;
        const startedAt = Date.now();
        activeRun = runSikulixScript({ ...environment, target: script.target, cwd: script.cwd },
            (line) => {
                log(line);
                parser.push(line);
            }
        );

        const exitCode = await activeRun.exited;
        const errors = parser.finish();
        publishScriptDiagnostics(script.pyFile, errors);

        const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
        log(`[run] finished with exit code ${exitCode} in ${elapsed}s`);

        // Not awaited: a notification carrying a button stays up until it is dismissed,
        // and waiting on it would hold `sikuliVS.running` true - leaving the toolbar
        // stuck on the stop button and refusing the next run.
        void announceOutcome(script.name, exitCode, elapsed, errors, parser.hadErrorOutput);

    } catch (err) {
        void showError(`SikuliVS Run Error: ${err}`);
    } finally {
        activeRun = null;
        releaseRun();
        await setRunning(false);
    }
}

function stopScript(): void {
    if (!activeRun) {
        return;
    }

    stopRequested = true;
    log('[run] stopping...');
    activeRun.stop();
}

/**
 * The script to run: the file the title-bar button belongs to, else the active editor.
 */
async function resolveDocument(resource?: vscode.Uri): Promise<vscode.TextDocument | null> {
    const document = resource
        ? await vscode.workspace.openTextDocument(resource)
        : vscode.window.activeTextEditor?.document;

    if (!document) {
        vscode.window.showWarningMessage('SikuliVS: No active text editor open.');
        return null;
    }

    if (document.languageId !== 'python') {
        vscode.window.showWarningMessage('SikuliVS: Only Python (Jython) scripts can be run.');
        return null;
    }

    return document;
}

/**
 * Says how the run ended. A script leaves nothing behind on the screen when it succeeds,
 * and the output channel is never revealed on its own, so without this a finished run is
 * indistinguishable from one that never started.
 */
async function announceOutcome(
    name: string,
    exitCode: number,
    elapsed: string,
    errors: ReturnType<ScriptErrorParser['finish']>,
    hadErrorOutput: boolean
): Promise<void> {
    if (stopRequested) {
        await showInfo(`SikuliVS: "${name}" stopped after ${elapsed}s.`);
        return;
    }

    if (exitCode === 0) {
        await showInfo(`SikuliVS: "${name}" finished successfully in ${elapsed}s.`);
        return;
    }

    await showError(failureMessage(errors, hadErrorOutput, exitCode));
}

/**
 * A non-zero exit with nothing on the error channel means the JVM died before SikuliX
 * could say why, which the raw exit code alone does not make obvious.
 */
function failureMessage(
    errors: ReturnType<ScriptErrorParser['finish']>,
    hadErrorOutput: boolean,
    exitCode: number
): string {
    const reported = errors[errors.length - 1];
    if (reported) {
        return `SikuliVS: ${reported.message}`;
    }

    if (!hadErrorOutput) {
        return (
            `SikuliVS: SikuliX exited with code ${exitCode} without reporting an error. ` +
            'Raise sikuliVS.debugLevel to 3 and re-run to see where it stopped.'
        );
    }

    return `SikuliVS: Script failed with exit code ${exitCode}. See the SikuliVS log.`;
}

function setRunning(running: boolean): Thenable<unknown> {
    return vscode.commands.executeCommand('setContext', RUNNING_CONTEXT, running);
}
