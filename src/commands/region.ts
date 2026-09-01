import * as vscode from 'vscode';
import { runPythonGui } from '../bridge/guiBridge';
import { showError } from '../utils/output';
import { findRegionRefAt } from '../utils/regionResolver';

/**
 * Command: sikuliVS.region
 * Launches a Python GUI overlay allowing the user to click and drag a region on their screen.
 * From the palette this inserts a new `Region(x, y, w, h)` string at the cursor; invoked from
 * the "Retake" CodeLens with a target line/character, it re-captures and replaces that call
 * in place instead.
 */
export function registerRegionCommand(context: vscode.ExtensionContext): void {
    const disposable = vscode.commands.registerCommand(
        'sikuliVS.region',
        async (incomingLineIndex?: number, incomingCharacter?: number) => {
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
                const snippet = `Region(${x}, ${y}, ${w}, ${h})`;

                // 3. Retake replaces the targeted call in place; otherwise insert at the cursor
                if (incomingLineIndex !== undefined) {
                    const lineText = editor.document.lineAt(incomingLineIndex).text;
                    const ref = findRegionRefAt(lineText, incomingCharacter ?? 0);
                    if (!ref) {
                        vscode.window.showWarningMessage('SikuliVS: Could not find the region to retake.');
                        return;
                    }
                    await editor.edit(editBuilder => {
                        editBuilder.replace(
                            new vscode.Range(incomingLineIndex, ref.start, incomingLineIndex, ref.end),
                            snippet
                        );
                    });
                } else {
                    insertTextAtCursor(editor, snippet);
                }

            } catch (err) {
                showError(`SikuliVS Region Error: ${err}`);
            }
        }
    );

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
