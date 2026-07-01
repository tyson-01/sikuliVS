import * as vscode from 'vscode';

export function registerOffsetCommand(context: vscode.ExtensionContext) {
    const disposable = vscode.commands.registerCommand('sikuliVS.offset', () => {
        vscode.window.showInformationMessage('Offset feature planned framework placeholder.');
    });
    context.subscriptions.push(disposable);
}