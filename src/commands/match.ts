import * as vscode from 'vscode';
import * as path from 'path';
import { parsePatternExpr, renderPatternExpr } from '../utils/patternExpression';
import { pickImagePath, resolveImageAt } from '../utils/resolver';
import { runPythonGui } from '../bridge/guiBridge';

const DEFAULT_SIMILARITY = 0.7;

/**
 * Command: sikuliVS.match
 * Launches a CV2 match window to tune the similarity of one image reference.
 * CodeLens passes the line and character offset of its reference; from the palette
 * the reference under the cursor is used.
 */
export function registerMatchCommand(context: vscode.ExtensionContext): void {
    const disposable = vscode.commands.registerCommand(
        'sikuliVS.match',
        async (incomingLineIndex?: number, incomingCharacter?: number) => {
            try {
                const editor = vscode.window.activeTextEditor;
                if (!editor) {
                    return;
                }

                const document = editor.document;
                const scriptDir = path.dirname(document.uri.fsPath);
                const cursor = editor.selection.active;

                const targetLineIndex = incomingLineIndex ?? cursor.line;
                const targetCharacter =
                    incomingCharacter ?? (incomingLineIndex === undefined ? cursor.character : 0);
                const lineText = document.lineAt(targetLineIndex).text;

                // 1. Locate the targeted image reference
                const resolved = resolveImageAt(lineText, scriptDir, targetCharacter);
                if (!resolved) {
                    vscode.window.showWarningMessage(
                        'SikuliVS: Could not parse a valid image reference on this line.'
                    );
                    return;
                }

                const imagePath = await pickImagePath(resolved);
                if (!imagePath) {
                    return; // Not found, or dismissed
                }

                // 2. Read any existing Pattern configuration
                const expr = parsePatternExpr(lineText, resolved.ref);
                const initialSimilarity = expr.similar ?? DEFAULT_SIMILARITY;

                // 3. Launch the backend match tuning window
                vscode.window.setStatusBarMessage('SikuliVS: Scanning screen for matches...', 2000);
                const result = await runPythonGui('match', [
                    '--image', imagePath,
                    '--similarity', String(initialSimilarity)
                ]);
                if (result === null) {
                    return; // Cancelled
                }

                const similar = parseFloat(result);
                if (isNaN(similar)) {
                    return;
                }

                // 4. Rewrite the Pattern expression in place
                await replaceRange(editor, targetLineIndex, expr.start, expr.end,
                    renderPatternExpr(expr, { similar }));

            } catch (err) {
                vscode.window.showErrorMessage(`SikuliVS Match Error: ${err}`);
            }
        }
    );

    context.subscriptions.push(disposable);
}

/** Replaces a character range on a single line of the active document. */
async function replaceRange(
    editor: vscode.TextEditor,
    lineIndex: number,
    start: number,
    end: number,
    newText: string
): Promise<boolean> {
    return editor.edit(editBuilder => {
        editBuilder.replace(new vscode.Range(lineIndex, start, lineIndex, end), newText);
    });
}
