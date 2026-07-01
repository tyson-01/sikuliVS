import * as vscode from 'vscode';
import * as path from 'path';
import { resolveImageFromLine } from '../utils/resolver';

export class ImageCodeLensProvider implements vscode.CodeLensProvider {
    public provideCodeLenses(
        document: vscode.TextDocument,
        token: vscode.CancellationToken
    ): vscode.CodeLens[] | Thenable<vscode.CodeLens[]> {
        const lenses: vscode.CodeLens[] = [];
        const scriptDir = path.dirname(document.uri.fsPath);

        for (let i = 0; i < document.lineCount; i++) {
            const lineText = document.lineAt(i).text;
            const resolved = resolveImageFromLine(lineText, scriptDir);

            if (resolved) {
                const range = new vscode.Range(i, 0, i, 0);

                // Command link to trigger relative target offsets (Phase 2)
                lenses.push(new vscode.CodeLens(range, {
                    title: "🎯 Set Offset",
                    command: "sikuliVS.offset",
                    arguments: [i] // Pass line number context index
                }));

                // Command link to run visual verification checks (Phase 3)
                lenses.push(new vscode.CodeLens(range, {
                    title: "🔍 Preview Match",
                    command: "sikuliVS.match",
                    arguments: [i]
                }));
            }
        }

        return lenses;
    }
}