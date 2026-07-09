import * as vscode from 'vscode';
import * as path from 'path';
import { parseSikuliLine, rebuildSikuliLine } from '../utils/modifier';
import { resolveImageFromLine, getTargetImagePath } from '../utils/resolver';
import { runPythonGui } from '../bridge/guiBridge';

/**
 * Command: sikuliVS.offset
 * Launches a targeted crosshair GUI over an image asset to calculate visual mouse offsets (dx, dy).
 * Modifies and updates the target document line inline.
 */
export function registerOffsetCommand(context: vscode.ExtensionContext): void {
    const disposable = vscode.commands.registerCommand(
        'sikuliVS.offset',
        async (incomingLineIndex?: number) => {
            try {
                const editor = vscode.window.activeTextEditor;
                if (!editor) return;

                const document = editor.document;
                const scriptDir = path.dirname(document.uri.fsPath);

                // 1. Determine targeted workspace line
                const targetLineIndex = incomingLineIndex ?? editor.selection.active.line;
                const lineText = document.lineAt(targetLineIndex).text;

                // 2. Parse structural token metadata from the target line
                const tokens = parseSikuliLine(lineText, scriptDir);
                if (!tokens) {
                    vscode.window.showWarningMessage("SikuliVS: Could not parse a valid image reference on this line.");
                    return;
                }

                // 3. Resolve target file assets 
                const resolvedPath = await resolveTargetAsset(lineText, scriptDir);
                if (!resolvedPath) return; // User canceled dynamic selection

                // 4. Fire up sidecar Python coordinate-picker GUI
                const initialOffset = tokens.currentOffset ?? [0, 0];
                const newOffset = await executeOffsetGui(resolvedPath, initialOffset);
                if (!newOffset) return; // Closed or bad return output

                // 5. Rewrite document line configuration with calculated coordinate pairs
                const updatedLineText = rebuildSikuliLine(tokens, { offset: newOffset });
                await replaceLineText(editor, targetLineIndex, lineText.length, updatedLineText);

            } catch (err) {
                if (err !== 'Cancelled') {
                    vscode.window.showErrorMessage(`SikuliVS Offset Error: ${err}`);
                }
            }
        }
    );

    context.subscriptions.push(disposable);
}

/**
 * Direct abstraction helper to identify image paths.
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
 * Coordinates sidecar python invocation to capture user click offsets.
 * Returns tuple [dx, dy] or null if processing was dropped or closed.
 */
async function executeOffsetGui(imagePath: string, [initDx, initDy]: [number, number]): Promise<[number, number] | null> {
    const guiFlags = [
        `--image "${imagePath}"`,
        `--dx ${initDx}`,
        `--dy ${initDy}`
    ];
    
    const result = await runPythonGui('offset', guiFlags);
    if (!result || result.trim() === '') return null;

    const [outDx, outDy] = result.split(',').map(Number);
    return isNaN(outDx) || isNaN(outDy) ? null : [outDx, outDy];
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