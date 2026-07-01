import * as vscode from 'vscode';

export function registerRegionCommand(context: vscode.ExtensionContext) {

    const disposable = vscode.commands.registerCommand(
        'sikuliVS.region',
        async () => {

            vscode.window.showInformationMessage(
                'Sikuli Region: not implemented yet'
            );

        }
    );

    context.subscriptions.push(disposable);
}