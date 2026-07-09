import * as vscode from 'vscode';
import * as path from 'path';
import { resolveImageFromLine } from '../utils/resolver';

/**
 * Custom CodeLens provider that scans the active file for image strings.
 * Injects floating actionable text links ("Set Offset", "Preview Match") directly above matches.
 */
export class ImageCodeLensProvider implements vscode.CodeLensProvider {
    
    public async provideCodeLenses(
        document: vscode.TextDocument,
        _token: vscode.CancellationToken
    ): Promise<vscode.CodeLens[]> {
        const lenses: vscode.CodeLens[] = [];
        const scriptDir = path.dirname(document.uri.fsPath);

        for (let i = 0; i < document.lineCount; i++) {
            const lineText = document.lineAt(i).text;
            const resolved = resolveImageFromLine(lineText, scriptDir);

            if (resolved) {
                // CodeLenses are anchored to a specific line range buffer
                const range = new vscode.Range(i, 0, i, 0);

                // Injects floating link to set mouse target offsets
                lenses.push(new vscode.CodeLens(range, {
                    title: "🎯 Set Offset",
                    command: "sikuliVS.offset",
                    arguments: [i] // Passes the specific line index context to the command listener
                }));

                // Injects floating link to run similarity matches
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