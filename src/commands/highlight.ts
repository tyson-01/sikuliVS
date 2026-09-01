import * as vscode from 'vscode';
import { runPythonGui } from '../bridge/guiBridge';
import { showError } from '../utils/output';
import { findRegionRefAt } from '../utils/regionResolver';

/**
 * Command: sikuliVS.highlight
 * Briefly outlines a `Region(x, y, w, h)` call's bounds on screen so the user can
 * confirm it still lines up with the target UI.
 * CodeLens passes the line and character offset of its call; from the palette
 * the call under the cursor is used.
 */
export function registerHighlightCommand(context: vscode.ExtensionContext): void {
    const disposable = vscode.commands.registerCommand(
        'sikuliVS.highlight',
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

                const ref = findRegionRefAt(lineText, targetCharacter);
                if (!ref) {
                    vscode.window.showWarningMessage(
                        'SikuliVS: Could not parse a Region(...) call on this line.'
                    );
                    return;
                }

                await runPythonGui('highlight', [
                    '--x', String(ref.x),
                    '--y', String(ref.y),
                    '--w', String(ref.w),
                    '--h', String(ref.h)
                ]);

            } catch (err) {
                showError(`SikuliVS Highlight Error: ${err}`);
            }
        }
    );

    context.subscriptions.push(disposable);
}
