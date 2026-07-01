import * as vscode from 'vscode';
import { captureRegion } from '../capture/x11Region';

export function registerRegionCommand(context: vscode.ExtensionContext) {

    const disposable = vscode.commands.registerCommand(
        'sikuliVS.region',
        async () => {

            const region = await captureRegion();

            const text = `Region(${region.x}, ${region.y}, ${region.width}, ${region.height})`;

            const editor = vscode.window.activeTextEditor;
            if (!editor) return;

            editor.edit(editBuilder => {
                const pos = editor.selection.active;
                editBuilder.insert(pos, text);
            });

        }
    );

    context.subscriptions.push(disposable);
}