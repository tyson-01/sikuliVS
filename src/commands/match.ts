import * as vscode from 'vscode';

export function registerMatchCommand(context: vscode.ExtensionContext) {
    const disposable = vscode.commands.registerCommand('sikuliVS.match', () => {
        vscode.window.showInformationMessage('Match preview feature planned framework placeholder.');
    });
    context.subscriptions.push(disposable);
}