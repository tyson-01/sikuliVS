import * as vscode from 'vscode';
import { findLocationRefs } from '../utils/locationResolver';

/**
 * Custom CodeLens provider that scans the active file for `Location(x, y)` calls.
 * Injects floating actionable text links ("Retake", "Show") above each one,
 * anchored to that call's own character range.
 */
export class LocationCodeLensProvider implements vscode.CodeLensProvider {

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

            for (const ref of findLocationRefs(lineText)) {
                const range = new vscode.Range(i, ref.start, i, ref.end);
                const args = [i, ref.start];

                lenses.push(new vscode.CodeLens(range, {
                    title: '🔄 Retake',
                    command: 'sikuliVS.location',
                    arguments: args
                }));

                lenses.push(new vscode.CodeLens(range, {
                    title: '📍 Show',
                    command: 'sikuliVS.showLocation',
                    arguments: args
                }));
            }
        }

        return lenses;
    }
}
