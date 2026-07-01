import * as vscode from 'vscode';
import { registerRegionCommand } from './commands/region';
import { registerCaptureCommand } from './commands/capture';
import { registerOffsetCommand } from './commands/offset';
import { registerMatchCommand } from './commands/match';
import { sikuliVSView } from './views/sikuliVSView';

export function activate(context: vscode.ExtensionContext) {
    registerRegionCommand(context);
    registerCaptureCommand(context);
    registerOffsetCommand(context);
    registerMatchCommand(context);

    const view = new sikuliVSView();
    context.subscriptions.push(
        vscode.window.registerTreeDataProvider('sikuliVS.regionView', view)
    );
}

export function deactivate() {}