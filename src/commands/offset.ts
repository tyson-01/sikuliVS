import * as vscode from 'vscode';
import * as path from 'path';
import { DEFAULT_SIMILARITY, parsePatternExpr, renderPatternExpr } from '../utils/patternExpression';
import { pickImagePath, resolveImageAt } from '../utils/resolver';
import { runPythonGui } from '../bridge/guiBridge';
import { showError } from '../utils/output';

/**
 * Command: sikuliVS.offset
 * Launches a crosshair GUI over an image asset to pick a mouse target offset (dx, dy),
 * then updates that image's Pattern expression in place.
 */
export function registerOffsetCommand(context: vscode.ExtensionContext): void {
    const disposable = vscode.commands.registerCommand(
        'sikuliVS.offset',
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
                const [initDx, initDy] = expr.targetOffset ?? [0, 0];

                // 3. Anchor the crosshair using the pattern's own similarity
                const result = await runPythonGui('offset', [
                    '--image', imagePath,
                    '--dx', String(initDx),
                    '--dy', String(initDy),
                    '--similarity', String(expr.similar ?? DEFAULT_SIMILARITY)
                ]);
                if (result === null) {
                    return; // Cancelled
                }

                const [dx, dy] = result.split(',').map(Number);
                if (isNaN(dx) || isNaN(dy)) {
                    return;
                }

                // 4. Rewrite the Pattern expression in place
                await replaceRange(editor, targetLineIndex, expr.start, expr.end,
                    renderPatternExpr(expr, { targetOffset: [dx, dy] }));

            } catch (err) {
                showError(`SikuliVS Offset Error: ${err}`);
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
