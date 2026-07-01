import * as vscode from 'vscode';
import { registerRegionCommand } from './commands/region';
import { sikuliVSView } from './views/sikuliVSView';

export function activate(context: vscode.ExtensionContext) {

    registerRegionCommand(context);

    const view = new sikuliVSView();
    context.subscriptions.push(
        vscode.window.registerTreeDataProvider(
            'sikuliVS.regionView',
            view
        )
    );

}

export function deactivate() {}