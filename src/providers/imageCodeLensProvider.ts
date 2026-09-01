import * as vscode from 'vscode';
import { findImageRefs } from '../utils/imageResolver';

/**
 * Custom CodeLens provider that scans the active file for image strings.
 * Injects floating actionable text links ("Set Offset", "Preview Match") above each one,
 * anchored to that reference's own character range.
 */
export class ImageCodeLensProvider implements vscode.CodeLensProvider {

    public async provideCodeLenses(
        document: vscode.TextDocument,
        token: vscode.CancellationToken
    ): Promise<vscode.CodeLens[]> {
        const lenses: vscode.CodeLens[] = [];

        for (let i = 0; i < document.lineCount; i++) {
            if (token.isCancellationRequested) {
                return lenses;
            }

            const lineText = document.lineAt(i).text;
            if (lineText.trim().startsWith('#')) {
                continue;
            }

            for (const ref of findImageRefs(lineText)) {
                const range = new vscode.Range(i, ref.start, i, ref.end);
                const args = [i, ref.start];

                lenses.push(new vscode.CodeLens(range, {
                    title: '🎯 Set Offset',
                    command: 'sikuliVS.offset',
                    arguments: args
                }));

                lenses.push(new vscode.CodeLens(range, {
                    title: '🔍 Preview Match',
                    command: 'sikuliVS.match',
                    arguments: args
                }));
            }
        }

        return lenses;
    }
}
