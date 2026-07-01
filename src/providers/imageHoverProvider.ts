import * as vscode from 'vscode';
import * as path from 'path';
import { resolveImageFromLine } from '../utils/resolver';

export class ImageHoverProvider implements vscode.HoverProvider {
    public provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.Hover> {
        const lineText = document.lineAt(position.line).text;
        const scriptDir = path.dirname(document.uri.fsPath);

        const resolved = resolveImageFromLine(lineText, scriptDir);
        if (!resolved || resolved.absolutePaths.length === 0) return null;

        // Construct Markdown content layout string for the popup frame
        const markdown = new vscode.MarkdownString();
        markdown.isTrusted = true;

        if (resolved.absolutePaths.length === 1) {
            const targetUri = vscode.Uri.file(resolved.absolutePaths[0]).toString();
            markdown.appendMarkdown(`### 📷 SikuliVS Image Preview\n\n`);
            markdown.appendMarkdown(`![Preview](${targetUri})\n\n`);
            markdown.appendMarkdown(`**Path:** \`${path.basename(resolved.absolutePaths[0])}\``);
        } else {
            markdown.appendMarkdown(`### 🔍 Multiple Matches Found (${resolved.absolutePaths.length})\n\n`);
            resolved.absolutePaths.slice(0, 5).forEach(p => {
                const targetUri = vscode.Uri.file(p).toString();
                markdown.appendMarkdown(`---\n`);
                markdown.appendMarkdown(`![Preview](${targetUri})\n\n`);
                markdown.appendMarkdown(`\`${path.basename(p)}\`\n`);
            });
            if (resolved.absolutePaths.length > 5) {
                markdown.appendMarkdown(`\n*And ${resolved.absolutePaths.length - 5} more files...*`);
            }
        }

        return new vscode.Hover(markdown);
    }
}