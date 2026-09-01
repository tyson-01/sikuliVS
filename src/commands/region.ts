import * as vscode from 'vscode';
import { runPythonGui } from '../bridge/guiBridge';
import { showError } from '../utils/output';

/**
 * Command: sikuliVS.region
 * Launches a Python GUI overlay allowing the user to click and drag a region on their screen.
 * Returns the coordinates and inserts a formatted `Region(x, y, w, h)` string at the cursor.
 */
export function registerRegionCommand(context: vscode.ExtensionContext): void {
    const disposable = vscode.commands.registerCommand('sikuliVS.region', async () => {
        try {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showWarningMessage('SikuliVS: No active text editor open.');
                return;
            }

            // 1. Request raw coordinate string from Python backend (e.g., "100,150,400,300")
            const rawOutput = await runPythonGui('region');
            if (rawOutput === null) {
                return; // User cancelled the selection
            }

            // 2. Parse coordinates and format the Sikuli script snippet
            const [x, y, w, h] = rawOutput.split(',').map(Number);
            if ([x, y, w, h].some(isNaN)) {
                vscode.window.showErrorMessage('SikuliVS: Backend returned invalid region coordinates.');
                return;
            }

            // 3. Inject the formatted string into the active document
            insertTextAtCursor(editor, `Region(${x}, ${y}, ${w}, ${h})`);

        } catch (err) {
            showError(`SikuliVS Region Error: ${err}`);
        }
    });

    context.subscriptions.push(disposable);
}

/**
 * Helper to safely mutate the active text document and insert text at the cursor position.
 */
function insertTextAtCursor(editor: vscode.TextEditor, text: string): void {
    editor.edit((editBuilder) => {
        editBuilder.insert(editor.selection.active, text);
    });
}
