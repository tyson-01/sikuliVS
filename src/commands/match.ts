import * as vscode from 'vscode';
import * as path from 'path';
import { parseSikuliLine, rebuildSikuliLine } from '../utils/modifier';
import { resolveImageFromLine, getTargetImagePath } from '../utils/resolver';
import { runPythonGui } from '../bridge/guiBridge';

/**
 * Command: sikuliVS.match
 * Launches a full-screen CV2 match window to tune image similarity targeting.
 * Accepts an optional `incomingLineIndex` if triggered via CodeLens or internal events.
 */
export function registerMatchCommand(context: vscode.ExtensionContext): void {
    const disposable = vscode.commands.registerCommand(
        'sikuliVS.match',
        async (incomingLineIndex?: number) => {
            try {
                const editor = vscode.window.activeTextEditor;
                if (!editor) return;

                const document = editor.document;
                const scriptDir = path.dirname(document.uri.fsPath);

                // 1. Context fallback: Use passed-in line index(eg codelens), or default to current cursor line
                const targetLineIndex = incomingLineIndex ?? editor.selection.active.line;
                const lineText = document.lineAt(targetLineIndex).text;

                // 2. Parse existing code tokens
                const tokens = parseSikuliLine(lineText, scriptDir);
                if (!tokens) {
                    vscode.window.showWarningMessage("SikuliVS: Could not parse a valid image reference on this line.");
                    return;
                }

                // 3. Resolve targeted asset path
                const resolvedPath = await resolveTargetAsset(lineText, scriptDir);
                if (!resolvedPath) return; // User canceled

                // 4. Launch backend Match tuning overlay
                const initialSimilarity = tokens.currentSimilarity ?? 0.7;
                const finalSimilarity = await executeMatchGui(resolvedPath, initialSimilarity);
                if (finalSimilarity === null) return; // UI closed or invalid output

                // 5. Rewrite the document line with the newly tuned similarity score
                const updatedLineText = rebuildSikuliLine(tokens, { similarity: finalSimilarity });
                await replaceLineText(editor, targetLineIndex, lineText.length, updatedLineText);

            } catch (err) {
                if (err !== 'Cancelled') {
                    vscode.window.showErrorMessage(`SikuliVS Match Error: ${err}`);
                }
            }
        }
    );

    context.subscriptions.push(disposable);
}

/**
 * Resolves the underlying image path, handling dynamic menus.
 */
async function resolveTargetAsset(lineText: string, scriptDir: string): Promise<string | null> {
    const resolvedImage = resolveImageFromLine(lineText, scriptDir);
    if (!resolvedImage) {
        vscode.window.showWarningMessage("SikuliVS: Could not resolve image paths.");
        return null;
    }
    return await getTargetImagePath(resolvedImage);
}

/**
 * Handles communication with the Python matching GUI, returning the resulting similarity score.
 */
async function executeMatchGui(imagePath: string, initialSimilarity: number): Promise<number | null> {
    const guiFlags = [
        `--image "${imagePath}"`,
        `--similarity ${initialSimilarity}`
    ];

    vscode.window.setStatusBarMessage("SikuliVS: Scanning screen for matches...", 2000);
    const result = await runPythonGui('match', guiFlags);
    
    const parsingResult = parseFloat(result.trim());
    return isNaN(parsingResult) ? null : parsingResult;
}

/**
 * Utility to execute an in-place line replacement inside the active text document.
 */
async function replaceLineText(editor: vscode.TextEditor, lineIndex: number, lineLength: number, newText: string): Promise<boolean> {
    return editor.edit(editBuilder => {
        const lineRange = new vscode.Range(lineIndex, 0, lineIndex, lineLength);
        editBuilder.replace(lineRange, newText);
    });
}