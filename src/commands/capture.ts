import * as vscode from 'vscode';
import * as path from 'path';
import { runPythonGui } from '../bridge/guiBridge';
import { showError } from '../utils/output';

/**
 * Command: sikuliVS.capture
 * Triggers a Python GUI to capture a screen region, automatically naming the
 * resulting image based on the active script directory and current line variable.
 */
export function registerCaptureCommand(context: vscode.ExtensionContext): void {
    const disposable = vscode.commands.registerCommand('sikuliVS.capture', async () => {
        try {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showWarningMessage('SikuliVS: No active text editor open.');
                return;
            }

            // 1. Extract environment context from the active file
            const fileDir = path.dirname(editor.document.uri.fsPath);
            const scriptName = path.basename(fileDir).replace('.sikuli', '');

            // 2. Determine the image filename based on the user's code context
            const imageName = determineImageName(editor, scriptName);
            const absoluteOutputPath = path.join(fileDir, imageName);

            // 3. Launch external Python GUI tool to take the screenshot
            const result = await runPythonGui('capture', ['--out', absoluteOutputPath]);
            if (result === null) {
                return; // User cancelled the snip
            }

            if (result !== 'SUCCESS') {
                vscode.window.showErrorMessage('SikuliVS: Backend capture failed.');
                return;
            }

            // 4. Inject the final string into the editor on success
            insertTextAtCursor(editor, `"${imageName}"`);

        } catch (err) {
            showError(`SikuliVS Capture Error: ${err}`);
        }
    });

    context.subscriptions.push(disposable);
}

/**
 * Analyzes the current cursor line. If it finds a variable assignment (e.g., `my_var =`),
 * it uses that variable for the image name. Otherwise, it falls back to a timestamp.
 */
function determineImageName(editor: vscode.TextEditor, scriptName: string): string {
    const currentLineText = editor.document.lineAt(editor.selection.active.line).text;
    const variableMatch = currentLineText.match(/^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*=/);

    if (variableMatch) {
        return `${scriptName}_${variableMatch[1]}.png`;
    }

    const timestamp = Math.floor(Date.now() / 1000);
    return `${scriptName}_${timestamp}.png`;
}

/**
 * Helper to safely mutate the active text document and insert text at the cursor position.
 */
function insertTextAtCursor(editor: vscode.TextEditor, text: string): void {
    editor.edit((editBuilder) => {
        editBuilder.insert(editor.selection.active, text);
    });
}
