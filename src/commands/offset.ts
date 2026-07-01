import * as vscode from 'vscode';
import * as path from 'path';
import { parseSikuliLine, rebuildSikuliLine } from '../utils/modifier';
import { resolveImageFromLine, getTargetImagePath } from '../utils/resolver'; // Fixed imports
import { runPythonGui } from '../bridge/guiBridge';

export function registerOffsetCommand(context: vscode.ExtensionContext) {
    const disposable = vscode.commands.registerCommand(
        'sikuliVS.offset',
        async (incomingLineIndex?: number) => {
            try {
                const editor = vscode.window.activeTextEditor;
                if (!editor) return;

                const document = editor.document;
                const scriptDir = path.dirname(document.uri.fsPath);

                // 1. Identify which line we are modifying
                const targetLineIndex = incomingLineIndex !== undefined ? incomingLineIndex : editor.selection.active.line;
                const lineText = document.lineAt(targetLineIndex).text;

                // 2. Parse structural token data out of the target line (for rebuilding later)
                const tokens = parseSikuliLine(lineText, scriptDir);
                if (!tokens) {
                    vscode.window.showWarningMessage("SikuliVS: Could not parse a valid image reference on this line.");
                    return;
                }

                // 3. Resolve file assets using our dedicated resolver module
                const resolvedImage = resolveImageFromLine(lineText, scriptDir);
                if (!resolvedImage) {
                    vscode.window.showWarningMessage("SikuliVS: Could not resolve image paths.");
                    return;
                }

                // Pass the correct ResolvedImage object to get the chosen absolute string path
                const resolvedPath = await getTargetImagePath(resolvedImage);
                if (!resolvedPath) return; // Cancelled by user selection exit

                // Extract existing offset configurations to pass down for prepopulation
                const initDx = tokens.currentOffset ? tokens.currentOffset[0] : 0;
                const initDy = tokens.currentOffset ? tokens.currentOffset[1] : 0;

                // 4. Invoke python sidecar window
                const guiFlags = [
                    `--image "${resolvedPath}"`,
                    `--dx ${initDx}`,
                    `--dy ${initDy}`
                ];
                
                const result = await runPythonGui('offset', guiFlags);
                const [outDx, outDy] = result.split(',').map(Number);

                // 5. Rebuild the line of text using new coordinates
                const updatedLineText = rebuildSikuliLine(tokens, {
                    offset: [outDx, outDy]
                });

                // Apply the code updates straight to the document layer
                await editor.edit(editBuilder => {
                    const lineRange = new vscode.Range(targetLineIndex, 0, targetLineIndex, lineText.length);
                    editBuilder.replace(lineRange, updatedLineText);
                });

            } catch (err) {
                if (err !== 'Cancelled') {
                    vscode.window.showErrorMessage(`SikuliVS Offset Error: ${err}`);
                }
            }
        }
    );
    context.subscriptions.push(disposable);
}