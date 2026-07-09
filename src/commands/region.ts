import * as vscode from 'vscode';
import { runPythonGui } from '../bridge/guiBridge';

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
            
            if (!rawOutput || rawOutput.trim() === '') {
                // User canceled
                return;
            }

            // 2. Parse coordinates and format the Sikuli script snippet
            const regionText = parseAndFormatRegion(rawOutput);

            // 3. Inject the formatted string into the active document
            insertTextAtCursor(editor, regionText);

        } catch (err) {
            vscode.window.showErrorMessage(`SikuliVS Error: ${err}`);
        }
    });

    context.subscriptions.push(disposable);
}

/**
 * Takes a comma-separated coordinate string from the backend and turns it 
 * into a Sikuli code snippet: "Region(x, y, w, h)"
 */
function parseAndFormatRegion(rawData: string): string {
    const [x, y, w, h] = rawData.split(',').map(Number);
    return `Region(${x}, ${y}, ${w}, ${h})`;
}

/**
 * Helper to safely mutate the active text document and insert text at the cursor position.
 */
function insertTextAtCursor(editor: vscode.TextEditor, text: string): void {
    editor.edit((editBuilder) => {
        const position = editor.selection.active;
        editBuilder.insert(position, text);
    });
}