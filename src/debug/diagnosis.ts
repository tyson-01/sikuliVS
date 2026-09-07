import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { AgentChannel } from './agentChannel';
import { parseFindFailed, Rect } from './findFailed';
import { DebugPanel, FrameRecord } from './panel';
import { log, outputChannel, showError } from '../utils/output';
import { resolveImagesOnLine } from '../utils/resolver';
import { DEFAULT_SIMILARITY, parsePatternExpr } from '../utils/patternExpression';

/** What to check, and where. A manually chosen image has no region to check in. */
interface Target {
    image: string;
    region: Rect | null;
}

/**
 * Works out why a search failed and hands the answer to the panel.
 *
 * Both the image and the region come from SikuliX's own failure message, which
 * is exact: it survives the image being held in a variable or passed into a
 * helper function, where reading the source line cannot.
 *
 * Runs while the script is still suspended. The interpreter that can answer is
 * alive now and gone the moment the run ends, so this cannot be deferred.
 */
export async function diagnoseFrame(
    channel: AgentChannel,
    panel: DebugPanel,
    index: number
): Promise<void> {
    const record = panel.frameAt(index);
    if (!record) {
        return;
    }

    const failure = parseFindFailed(record.text ?? '');
    const target: Target | null = failure ?? await askForTarget(record.text ?? '');
    if (!target) {
        return;
    }

    // Both the region and the match are reported relative to the screenshot.
    const bounds = record.capture.bounds;
    const region = target.region && {
        x: target.region.x - bounds.x,
        y: target.region.y - bounds.y,
        w: target.region.w,
        h: target.region.h
    };

    try {
        const body = await channel.request('diagnose', {
            image: target.image,
            screenshot: record.capture.path,
            region
        });

        panel.setDiagnosis(index, {
            imagePath: body?.imageFound ? body.imagePath : null,
            required: requiredSimilarity(record, body?.minSimilarity),
            inRegion: body?.inRegion ?? null,
            overall: body?.overall ?? null,
            region: region ?? null
        });
    } catch (err) {
        void showError(
            `SikuliVS: Could not check that image (${err}). The script may have finished.`
        );
    }
}

/**
 * Falls back to asking, when SikuliX's failure message is not in a shape the
 * parser knows. Searches the whole screen, since the region is then unknown.
 */
async function askForTarget(text: string): Promise<Target | null> {
    log(`[debug] could not read this failure message:\n${text}`);

    const choice = await vscode.window.showWarningMessage(
        'SikuliVS: Could not tell from SikuliX\'s message which image this was looking ' +
        'for. The message is in the SikuliVS log; pick the image to check it against ' +
        'the whole screen.',
        'Choose Image...',
        'Show Log'
    );

    if (choice === 'Show Log') {
        outputChannel().show(true);
        return null;
    }
    if (choice !== 'Choose Image...') {
        return null;
    }

    const picked = await vscode.window.showOpenDialog({
        canSelectMany: false,
        openLabel: 'Check this image',
        filters: { Images: ['png', 'jpg', 'jpeg'] }
    });

    return picked?.length ? { image: picked[0].fsPath, region: null } : null;
}

/**
 * The similarity the search demanded: a `Pattern(...).similar(n)` on the line if
 * there is one, else whatever SikuliX's own default is set to.
 */
function requiredSimilarity(record: FrameRecord, fallback: unknown): number {
    const text = sourceLine(record.file, record.line);
    const resolved = resolveImagesOnLine(text, path.dirname(record.file))
        .find(candidate => candidate.absolutePaths.length > 0);

    const declared = resolved && parsePatternExpr(text, resolved.ref).similar;
    return declared ?? (typeof fallback === 'number' ? fallback : DEFAULT_SIMILARITY);
}

function sourceLine(file: string, line: number): string {
    try {
        return fs.readFileSync(file, 'utf8').split(/\r?\n/)[line - 1] ?? '';
    } catch {
        return '';
    }
}
