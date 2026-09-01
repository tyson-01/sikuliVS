import * as vscode from 'vscode';
import { registerRegionCommand } from './commands/region';
import { registerCaptureCommand } from './commands/capture';
import { registerOffsetCommand } from './commands/offset';
import { registerMatchCommand } from './commands/match';
import { SikuliVSView } from './views/sikuliVSView';
import { ImageHoverProvider } from './providers/imageHoverProvider';
import { ImageCodeLensProvider } from './providers/imageCodeLensProvider';
import { outputChannel } from './utils/output';

// Target files for background features (Hover, CodeLens)
const PYTHON_FILE_SELECTOR: vscode.DocumentSelector = { scheme: 'file', language: 'python' };

/**
 * Extension Entrypoint
 * Called automatically by VS Code when the activationEvents defined in package.json are triggered.
 */
export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(outputChannel());
    registerCommands(context);
    registerViews(context);
    registerProviders(context);
}

// UI Actions triggered via Command Palette or keybindings
function registerCommands(context: vscode.ExtensionContext): void {
    registerRegionCommand(context);
    registerCaptureCommand(context);
    registerOffsetCommand(context);
    registerMatchCommand(context);
}

// Custom UI panels rendered in the sidebar
function registerViews(context: vscode.ExtensionContext): void {
    const view = new SikuliVSView();
    context.subscriptions.push(
        vscode.window.registerTreeDataProvider('sikuliVS.regionView', view)
    );
}

// Passive background listeners that inject features directly into the text editor
function registerProviders(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.languages.registerHoverProvider(PYTHON_FILE_SELECTOR, new ImageHoverProvider()),
        vscode.languages.registerCodeLensProvider(PYTHON_FILE_SELECTOR, new ImageCodeLensProvider())
    );
}

/**
 * Cleanup function called automatically when the extension is disabled or uninstalled.
 * (VS Code handles standard subscription disposal automatically).
 */
export function deactivate(): void {}