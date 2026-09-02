import * as vscode from 'vscode';
import { runPythonGui } from '../bridge/guiBridge';
import { showError } from '../utils/output';
import { findLocationRefAt } from '../utils/locationResolver';

/**
 * Command: sikuliVS.showLocation
 * Briefly marks a `Location(x, y)` call's point on screen with a crosshair so the user
 * can confirm it still lands on the target UI.
 * CodeLens passes the line and character offset of its call; from the palette
 * the call under the cursor is used.
 */
export function registerShowLocationCommand(context: vscode.ExtensionContext): void {
    const disposable = vscode.commands.registerCommand(
        'sikuliVS.showLocation',
        async (incomingLineIndex?: number, incomingCharacter?: number) => {
            try {
                const editor = vscode.window.activeTextEditor;
                if (!editor) {
                    return;
                }

                const cursor = editor.selection.active;
                const targetLineIndex = incomingLineIndex ?? cursor.line;
                const targetCharacter =
                    incomingCharacter ?? (incomingLineIndex === undefined ? cursor.character : 0);
                const lineText = editor.document.lineAt(targetLineIndex).text;

                const ref = findLocationRefAt(lineText, targetCharacter);
                if (!ref) {
                    vscode.window.showWarningMessage(
                        'SikuliVS: Could not parse a Location(...) call on this line.'
                    );
                    return;
                }

                await runPythonGui('showlocation', [
                    '--x', String(ref.x),
                    '--y', String(ref.y)
                ]);

            } catch (err) {
                showError(`SikuliVS Show Location Error: ${err}`);
            }
        }
    );

    context.subscriptions.push(disposable);
}
