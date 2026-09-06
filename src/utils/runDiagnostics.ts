import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ScriptError, errorSource, SCRIPT_MODULE } from './runErrors';

let collection: vscode.DiagnosticCollection | undefined;

/**
 * The "sikulix" diagnostics, where a failed run's error line is reported.
 */
export function diagnosticCollection(): vscode.DiagnosticCollection {
    if (!collection) {
        collection = vscode.languages.createDiagnosticCollection('sikulix');
    }
    return collection;
}

/**
 * Clears the whole collection, since a failure can land in any file the script imported,
 * not just the one that was launched.
 */
export function clearRunDiagnostics(): void {
    diagnosticCollection().clear();
}

/**
 * Marks up whatever SikuliX reported, in whichever file it happened. Launch failures are
 * skipped: they are about the run itself, not a line of code.
 */
export function publishScriptDiagnostics(pyFile: string, errors: ScriptError[]): void {
    const byFile = new Map<string, vscode.Diagnostic[]>();

    for (const error of errors) {
        if (error.launchFailure) {
            continue;
        }

        const source = errorSource(error);
        const file = resolveModuleFile(pyFile, source.module);
        const existing = byFile.get(file) ?? [];
        existing.push(toDiagnostic(error.message, source.line, source.column));
        byFile.set(file, existing);
    }

    for (const [file, diagnostics] of byFile) {
        diagnosticCollection().set(vscode.Uri.file(file), diagnostics);
    }
}

/**
 * Marks up a failure whose location is already known, as the debugger's own report is:
 * it names the file and line directly rather than through SikuliX's console output.
 */
export function publishKnownError(
    file: string,
    line: number,
    column: number | undefined,
    message: string
): void {
    diagnosticCollection().set(vscode.Uri.file(file), [toDiagnostic(message, line, column)]);
}

/**
 * Maps a traceback frame's module back to a file. SikuliX names the launched script
 * `main`; anything it imported keeps its own module name, which in a bundle is a sibling
 * `.py` beside the script.
 */
function resolveModuleFile(pyFile: string, module: string): string {
    if (module === SCRIPT_MODULE) {
        return pyFile;
    }

    const sibling = path.join(path.dirname(pyFile), `${module}.py`);
    return fs.existsSync(sibling) ? sibling : pyFile;
}

function toDiagnostic(message: string, line: number, column?: number): vscode.Diagnostic {
    const lineIndex = Math.max(0, line - 1);
    const startColumn = column ? Math.max(0, column - 1) : 0;
    const range = new vscode.Range(lineIndex, startColumn, lineIndex, Number.MAX_SAFE_INTEGER);

    const diagnostic = new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Error);
    diagnostic.source = 'sikulix';
    return diagnostic;
}
