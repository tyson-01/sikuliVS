import * as vscode from 'vscode';
import * as path from 'path';
import { parseSikuliLine, rebuildSikuliLine } from '../utils/modifier';
import { resolveImageFromLine, getTargetImagePath } from '../utils/resolver';
import { runPythonGui } from '../bridge/guiBridge';

export function registerMatchCommand(context: vscode.ExtensionContext) {
    const disposable = vscode.commands.registerCommand(
        'sikuliVS.match',
        async (incomingLineIndex?: number) => {
            try {
                const editor = vscode.window.activeTextEditor;
                if (!editor) return;

                const document = editor.document;
                const scriptDir = path.dirname(document.uri.fsPath);

                // 1. Determine target code line index
                const targetLineIndex = incomingLineIndex !== undefined ? incomingLineIndex : editor.selection.active.line;
                const lineText = document.lineAt(targetLineIndex).text;

                // 2. Parse existing code modifications (if any)
                const tokens = parseSikuliLine(lineText, scriptDir);
                if (!tokens) {
                    vscode.window.showWarningMessage("SikuliVS: Could not parse a valid image reference on this line.");
                    return;
                }

                // 3. Resolve file assets (handles dynamic QuickPick selection seamlessly)
                const resolvedImage = resolveImageFromLine(lineText, scriptDir);
                if (!resolvedImage) {
                    vscode.window.showWarningMessage("SikuliVS: Could not resolve image paths.");
                    return;
                }

                const resolvedPath = await getTargetImagePath(resolvedImage);
                if (!resolvedPath) return; // User exited choice menu

                // Pull previous similarity score to seed the slider. Default to 0.7 if non-existent.
                const initSim = tokens.currentSimilarity !== null ? tokens.currentSimilarity : 0.7;

                // 4. Fire up full-screen CV2 match window
                const guiFlags = [
                    `--image "${resolvedPath}"`,
                    `--similarity ${initSim}`
                ];

                vscode.window.setStatusBarMessage("SikuliVS: Scanning screen for matches...", 2000);
                const result = await runPythonGui('match', guiFlags);
                
                const finalSimilarity = parseFloat(result.trim());
                if (isNaN(finalSimilarity)) return;

                // 5. Build and rewrite document line with new parameters
                const updatedLineText = rebuildSikuliLine(tokens, {
                    similarity: finalSimilarity
                });

                await editor.edit(editBuilder => {
                    const lineRange = new vscode.Range(targetLineIndex, 0, targetLineIndex, lineText.length);
                    editBuilder.replace(lineRange, updatedLineText);
                });

            } catch (err) {
                if (err !== 'Cancelled') {
                    vscode.window.showErrorMessage(`SikuliVS Match Error: ${err}`);
                }
            }
        }
    );
    context.subscriptions.push(disposable);
}