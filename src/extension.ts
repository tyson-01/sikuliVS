import * as vscode from 'vscode';
import { registerRegionCommand } from './commands/region';
import { registerCaptureCommand } from './commands/capture';
import { registerOffsetCommand } from './commands/offset';
import { registerMatchCommand } from './commands/match';
import { sikuliVSView } from './views/sikuliVSView';

// Import our new UI providers
import { ImageHoverProvider } from './providers/imageHoverProvider';
import { ImageCodeLensProvider } from './providers/imageCodeLensProvider';

export function activate(context: vscode.ExtensionContext) {
    registerRegionCommand(context);
    registerCaptureCommand(context);
    registerOffsetCommand(context);
    registerMatchCommand(context);

    const view = new sikuliVSView();
    context.subscriptions.push(
        vscode.window.registerTreeDataProvider('sikuliVS.regionView', view)
    );

    // Document selector targeted to capture Jython context paths
    const pythonSelector: vscode.DocumentSelector = { scheme: 'file', language: 'python' };

    // Register Hover Previews
    context.subscriptions.push(
        vscode.languages.registerHoverProvider(pythonSelector, new ImageHoverProvider())
    );

    // Register Live Floating Action Code Lenses
    context.subscriptions.push(
        vscode.languages.registerCodeLensProvider(pythonSelector, new ImageCodeLensProvider())
    );
}

export function deactivate() {}