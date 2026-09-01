import * as vscode from 'vscode';
import * as path from 'path';
import { resolveImageAt } from '../utils/resolver';

/**
 * Custom hover provider that listens for mouse hovers over image strings.
 * Renders an inline Markdown popup previewing the corresponding screenshot(s).
 */
export class ImageHoverProvider implements vscode.HoverProvider {

    public async provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken
    ): Promise<vscode.Hover | null> {
        const lineText = document.lineAt(position.line).text;
        const scriptDir = path.dirname(document.uri.fsPath);

        const resolved = resolveImageAt(lineText, scriptDir, position.character);
        if (!resolved || resolved.absolutePaths.length === 0) {
            return null;
        }

        const markdown = new vscode.MarkdownString();
        markdown.isTrusted = true;

        const totalMatches = resolved.absolutePaths.length;

        if (totalMatches === 1) {
            // Case 1: Render a single-image preview frame
            const absolutePath = resolved.absolutePaths[0];
            const targetUri = vscode.Uri.file(absolutePath).toString();

            markdown.appendMarkdown(`### 📷 SikuliVS Image Preview\n\n`);
            markdown.appendMarkdown(`![Preview](${targetUri})\n\n`);
            markdown.appendMarkdown(`**Path:** \`${path.basename(absolutePath)}\``);
        } else {
            // Case 2: Render a multi-image list overlay capped at a max of 5 elements
            markdown.appendMarkdown(`### 🔍 Multiple Matches Found (${totalMatches})\n\n`);

            for (const absolutePath of resolved.absolutePaths.slice(0, 5)) {
                const targetUri = vscode.Uri.file(absolutePath).toString();
                markdown.appendMarkdown(`---\n`);
                markdown.appendMarkdown(`![Preview](${targetUri})\n\n`);
                markdown.appendMarkdown(`\`${path.basename(absolutePath)}\`\n`);
            }

            if (totalMatches > 5) {
                markdown.appendMarkdown(`\n*And ${totalMatches - 5} more files...*`);
            }
        }

        const range = new vscode.Range(position.line, resolved.ref.start, position.line, resolved.ref.end);
        return new vscode.Hover(markdown, range);
    }
}
