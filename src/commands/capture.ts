import * as vscode from 'vscode';
import * as path from 'path';
import { runPythonGui } from '../bridge/guiBridge';

export function registerCaptureCommand(context: vscode.ExtensionContext) {
    const disposable = vscode.commands.registerCommand(
        'sikuliVS.capture',
        async () => {
            try {
                const editor = vscode.window.activeTextEditor;
                if (!editor) {
                    vscode.window.showWarningMessage('SikuliVS: No active text editor open.');
                    return;
                }

                const activeDocument = editor.document;
                const fileUri = activeDocument.uri;
                const fileDir = path.dirname(fileUri.fsPath);
                
                // 1. Parse the script directory name (e.g., "my_script.sikuli" -> "my_script")
                const scriptDirName = path.basename(fileDir).replace('.sikuli', '');

                // 2. Read the current line to check for variable assignment
                const currentLineText = activeDocument.lineAt(editor.selection.active.line).text;
                const variableMatch = currentLineText.match(/^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*=/);

                let imageName = '';
                if (variableMatch) {
                    // Match found: "my_var =" -> "my_script_my_var.png"
                    imageName = `${scriptDirName}_${variableMatch[1]}.png`;
                } else {
                    // Fallback to random fixed length string timestamp: "my_script_1719853921.png"
                    imageName = `${scriptDirName}_${Math.floor(Date.now() / 1000)}.png`;
                }

                // 3. Resolve the absolute output path to drop it right in the script's directory
                const absoluteOutputPath = path.join(fileDir, imageName);

                // 4. Spin up the backend capture UI passing the path as a flag
                const output = await runPythonGui('capture', [`--out "${absoluteOutputPath}"`]);

                if (output === 'SUCCESS') {
                    // 5. Build clean, idiomatic Sikuli string literal: "image_name.png"
                    const textToInsert = `"${imageName}"`;

                    editor.edit(editBuilder => {
                        const pos = editor.selection.active;
                        editBuilder.insert(pos, textToInsert);
                    });
                } else {
                    vscode.window.showErrorMessage(`SikuliVS: Backend capture failed.`);
                }
            } catch (err) {
                vscode.window.showInformationMessage(`SikuliVS: ${err}`);
            }
        }
    );
    context.subscriptions.push(disposable);
}