import * as vscode from 'vscode';
import { registerRegionCommand } from './commands/region';
import { registerLocationCommand } from './commands/location';
import { registerCaptureCommand } from './commands/capture';
import { registerOffsetCommand } from './commands/offset';
import { registerMatchCommand } from './commands/match';
import { registerHighlightCommand } from './commands/highlight';
import { registerShowLocationCommand } from './commands/showLocation';
import { registerCompletionCommand } from './commands/completion';
import { registerSetup } from './setup/setup';
import { managedInterpreter, managedRoot } from './setup/managedEnvironment';
import { registerGuiContext } from './bridge/guiBridge';
import { registerManagedVenv } from './utils/pythonConfig';
import { registerRunCommands } from './commands/run';
import { registerDebugging } from './debug/register';
import { SikuliVSView } from './views/sikuliVSView';
import { ImageHoverProvider } from './providers/imageHoverProvider';
import { ImageCodeLensProvider } from './providers/imageCodeLensProvider';
import { RegionCodeLensProvider } from './providers/regionCodeLensProvider';
import { LocationCodeLensProvider } from './providers/locationCodeLensProvider';
import { log, outputChannel } from './utils/output';
import { diagnosticCollection } from './utils/runDiagnostics';
import { discardPending, sweepStaleTempDirs } from './debug/captures';

// Target files for background features (Hover, CodeLens)
const PYTHON_FILE_SELECTOR: vscode.DocumentSelector = { scheme: 'file', language: 'python' };

/**
 * Extension Entrypoint
 * Called automatically by VS Code when the activationEvents defined in package.json are triggered.
 */
export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(outputChannel(), diagnosticCollection());

    // Says which build is actually live and where it keeps what it installs. Installing a
    // .vsix over the same version number can silently leave the old one in place, and
    // neither path is guessable from outside, so both are worth one line.
    log(`[sikulivs] activated ${context.extension.packageJSON.version} from ${context.extensionPath}`);
    log(`[sikulivs] managed storage: ${managedRoot(context)}`);

    // Everything the extension installed for itself lives under globalStorage, and the
    // parts of the code that need it cannot reach the context, so it is handed over here.
    registerGuiContext(context);
    registerManagedVenv(managedInterpreter(context));

    // Debug sessions leave a temp folder behind if the editor is killed mid-run.
    sweepStaleTempDirs();

    registerCommands(context);
    registerViews(context);
    registerProviders(context);
}

// UI Actions triggered via Command Palette or keybindings
function registerCommands(context: vscode.ExtensionContext): void {
    registerRunCommands(context);
    registerDebugging(context);
    registerRegionCommand(context);
    registerCaptureCommand(context);
    registerOffsetCommand(context);
    registerMatchCommand(context);
    registerHighlightCommand(context);
    registerLocationCommand(context);
    registerShowLocationCommand(context);
    registerCompletionCommand(context);
    registerSetup(context);
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
        vscode.languages.registerCodeLensProvider(PYTHON_FILE_SELECTOR, new ImageCodeLensProvider()),
        vscode.languages.registerCodeLensProvider(PYTHON_FILE_SELECTOR, new RegionCodeLensProvider()),
        vscode.languages.registerCodeLensProvider(PYTHON_FILE_SELECTOR, new LocationCodeLensProvider())
    );
}

/**
 * Cleanup function called automatically when the extension is disabled or uninstalled.
 * (VS Code handles standard subscription disposal automatically).
 */
export function deactivate(): void {
    discardPending();
}