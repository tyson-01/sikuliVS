import * as vscode from 'vscode';
import { runPythonGui } from '../bridge/guiBridge';
import { showError } from '../utils/output';
import { findLocationRefAt, LocationRef } from '../utils/locationResolver';

/**
 * Command: sikuliVS.location
 * Launches a Python GUI overlay with a magnifying loupe so a single screen pixel can be
 * picked precisely. From the palette this inserts a new `Location(x, y)` string at the
 * cursor; invoked from the "Retake" CodeLens with a target line/character, it re-picks
 * and replaces that call in place, seeded with its current point.
 */
export function registerLocationCommand(context: vscode.ExtensionContext): void {
    const disposable = vscode.commands.registerCommand(
        'sikuliVS.location',
        async (incomingLineIndex?: number, incomingCharacter?: number) => {
            try {
                const editor = vscode.window.activeTextEditor;
                if (!editor) {
                    vscode.window.showWarningMessage('SikuliVS: No active text editor open.');
                    return;
                }

                // 1. A retake seeds the picker with the point already in the code
                let existing: LocationRef | null = null;
                if (incomingLineIndex !== undefined) {
                    const lineText = editor.document.lineAt(incomingLineIndex).text;
                    existing = findLocationRefAt(lineText, incomingCharacter ?? 0);
                    if (!existing) {
                        vscode.window.showWarningMessage('SikuliVS: Could not find the location to retake.');
                        return;
                    }
                }

                const args = existing
                    ? ['--x', String(existing.x), '--y', String(existing.y)]
                    : [];

                // 2. Request the raw coordinate string from the Python backend (e.g., "1284,730")
                const rawOutput = await runPythonGui('location', args);
                if (rawOutput === null) {
                    return; // User cancelled the pick
                }

                const [x, y] = rawOutput.split(',').map(Number);
                if ([x, y].some(isNaN)) {
                    vscode.window.showErrorMessage('SikuliVS: Backend returned invalid location coordinates.');
                    return;
                }
                const snippet = `Location(${x}, ${y})`;

                // 3. Retake replaces the targeted call in place; otherwise insert at the cursor
                if (existing && incomingLineIndex !== undefined) {
                    await editor.edit(editBuilder => {
                        editBuilder.replace(
                            new vscode.Range(incomingLineIndex, existing.start, incomingLineIndex, existing.end),
                            snippet
                        );
                    });
                } else {
                    insertTextAtCursor(editor, snippet);
                }

            } catch (err) {
                showError(`SikuliVS Location Error: ${err}`);
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
