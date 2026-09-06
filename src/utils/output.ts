import * as vscode from 'vscode';

let channel: vscode.OutputChannel | undefined;

/**
 * The "SikuliVS" output channel, where Python stderr and command failures are recorded.
 */
export function outputChannel(): vscode.OutputChannel {
    if (!channel) {
        channel = vscode.window.createOutputChannel('SikuliVS');
    }
    return channel;
}

export function log(message: string): void {
    outputChannel().appendLine(message);
}

/**
 * Reports a failure, offering to reveal the log where the Python traceback lands.
 */
export async function showError(message: string): Promise<void> {
    log(message);
    const choice = await vscode.window.showErrorMessage(message, 'Show Log');
    if (choice === 'Show Log') {
        outputChannel().show(true);
    }
}

/**
 * Reports an outcome worth noticing without treating it as a fault.
 *
 * Deliberately does not log: callers announce a run in the channel already, and this only
 * surfaces what happened. The channel is never revealed on its own, since a panel opening
 * resizes the editor and changes the screen a script acts on.
 */
export async function showInfo(message: string): Promise<void> {
    const choice = await vscode.window.showInformationMessage(message, 'Show Log');
    if (choice === 'Show Log') {
        outputChannel().show(true);
    }
}
