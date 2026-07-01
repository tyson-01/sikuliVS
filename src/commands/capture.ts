import * as vscode from 'vscode';

export function registerCaptureCommand(context: vscode.ExtensionContext) {
    const disposable = vscode.commands.registerCommand('sikuliVS.capture', () => {
        vscode.window.showInformationMessage('Capture feature planned framework placeholder.');
    });
    context.subscriptions.push(disposable);
}