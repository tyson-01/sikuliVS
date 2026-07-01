import * as vscode from 'vscode';
import { runPythonGui } from '../bridge/guiBridge';

export function registerRegionCommand(context: vscode.ExtensionContext) {
    const disposable = vscode.commands.registerCommand(
        'sikuliVS.region',
        async () => {
            try {
                const output = await runPythonGui('region');
                const [x, y, w, h] = output.split(',').map(Number);
                
                const text = `Region(${x}, ${y}, ${w}, ${h})`;
                const editor = vscode.window.activeTextEditor;
                if (!editor) return;

                editor.edit(editBuilder => {
                    const pos = editor.selection.active;
                    editBuilder.insert(pos, text);
                });
            } catch (err) {
                vscode.window.showInformationMessage(`SikuliVS: ${err}`);
            }
        }
    );
    context.subscriptions.push(disposable);
}