import * as vscode from 'vscode';
import { findRegionRefs } from '../utils/regionResolver';

/**
 * Custom CodeLens provider that scans the active file for `Region(x, y, w, h)` calls.
 * Injects floating actionable text links ("Retake", "Highlight") above each one,
 * anchored to that call's own character range.
 */
export class RegionCodeLensProvider implements vscode.CodeLensProvider {

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

            for (const ref of findRegionRefs(lineText)) {
                const range = new vscode.Range(i, ref.start, i, ref.end);
                const args = [i, ref.start];

                lenses.push(new vscode.CodeLens(range, {
                    title: '🔄 Retake',
                    command: 'sikuliVS.region',
                    arguments: args
                }));

                lenses.push(new vscode.CodeLens(range, {
                    title: '✨ Highlight',
                    command: 'sikuliVS.highlight',
                    arguments: args
                }));
            }
        }

        return lenses;
    }
}
