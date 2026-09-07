import * as vscode from 'vscode';
import * as path from 'path';
import { CaptureFrame } from './captures';
import { buildOverlay, Diagnosis, Overlay, verdictsHtml } from './overlay';

/** What the panel knows about one stop. */
export interface FrameRecord {
    capture: CaptureFrame;
    file: string;
    line: number;
    reason: string;
    text?: string;
    /** The source line that produced this frame. */
    label?: string;
    /** How long that line took, in seconds. */
    elapsed?: number;
    /** Filled in once a FindFailed has been diagnosed. */
    diagnosis?: Diagnosis;
}

const VIEW_TYPE = 'sikuliVS.debugPanel';

/**
 * The SikuliVS Debug panel: what the screen looked like at each stop, with the
 * searched region and best match drawn over it, and a filmstrip of the run.
 *
 * Overlays are drawn in the page rather than burned into the PNG, so the capture
 * stays exactly what SikuliX saw and the boxes can be turned off.
 */
export class DebugPanel {
    private static current: DebugPanel | undefined;

    private readonly frames: FrameRecord[] = [];
    private selected = 0;
    private disposed = false;

    private constructor(
        private readonly panel: vscode.WebviewPanel,
        private readonly extensionUri: vscode.Uri,
        private readonly onDiagnose: (index: number) => void,
        private readonly onClosed: () => void
    ) {
        panel.onDidDispose(() => this.dispose());
        panel.webview.onDidReceiveMessage((message) => this.receive(message));
    }

    static show(
        extensionUri: vscode.Uri,
        captureDir: string,
        onDiagnose: (index: number) => void,
        onClosed: () => void
    ): DebugPanel {
        if (DebugPanel.current && !DebugPanel.current.disposed) {
            DebugPanel.current.panel.reveal(vscode.ViewColumn.Beside, true);
            return DebugPanel.current;
        }

        const panel = vscode.window.createWebviewPanel(
            VIEW_TYPE,
            'SikuliVS Debug',
            { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [extensionUri, vscode.Uri.file(captureDir)]
            }
        );

        DebugPanel.current = new DebugPanel(panel, extensionUri, onDiagnose, onClosed);
        DebugPanel.current.render();
        return DebugPanel.current;
    }

    static active(): DebugPanel | undefined {
        return DebugPanel.current && !DebugPanel.current.disposed ? DebugPanel.current : undefined;
    }

    /**
     * Revealed without focus: taking focus would pull the user off the editor
     * every time the script stops.
     */
    addFrame(record: FrameRecord, reveal = true): void {
        this.frames.push(record);
        this.selected = record.capture.index;
        this.render();

        // Frames recorded mid-run are not worth pulling the panel forward for;
        // a stop is.
        if (reveal) {
            this.panel.reveal(vscode.ViewColumn.Beside, true);
        }
    }

    setDiagnosis(index: number, diagnosis: Diagnosis): void {
        const record = this.frames.find(frame => frame.capture.index === index);
        if (record) {
            record.diagnosis = diagnosis;
            this.render();
        }
    }

    frameAt(index: number): FrameRecord | undefined {
        return this.frames.find(frame => frame.capture.index === index);
    }

    /** The captures are about to be deleted; stop pointing at them. */
    sessionEnded(): void {
        if (!this.disposed) {
            this.panel.webview.postMessage({ type: 'sessionEnded' });
        }
    }

    dispose(): void {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        DebugPanel.current = undefined;
        this.onClosed();
        this.panel.dispose();
    }

    private receive(message: { type: string; index?: number }): void {
        if (message.type === 'select' && typeof message.index === 'number') {
            this.selected = message.index;
            this.render();
            return;
        }

        if (message.type === 'diagnose' && typeof message.index === 'number') {
            this.onDiagnose(message.index);
        }
    }

    private uri(file: string | null): string {
        return file ? this.panel.webview.asWebviewUri(vscode.Uri.file(file)).toString() : '';
    }

    private render(): void {
        if (this.disposed) {
            return;
        }
        this.panel.webview.html = this.html();
    }

    private html(): string {
        const nonce = randomNonce();
        const csp = [
            "default-src 'none'",
            `img-src ${this.panel.webview.cspSource} data:`,
            `style-src ${this.panel.webview.cspSource} 'nonce-${nonce}'`,
            `script-src 'nonce-${nonce}'`
        ].join('; ');

        const current = this.frames.find(frame => frame.capture.index === this.selected)
            ?? this.frames[this.frames.length - 1];
        const overlay = current
            ? buildOverlay(current.diagnosis, current.capture.bounds)
            : { html: '', css: '' };

        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<style nonce="${nonce}">
${STYLES}
${overlay.css}
</style>
</head>
<body>
${current ? this.stage(current, overlay) : EMPTY_STATE}
${this.filmstrip()}
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
document.querySelectorAll('[data-index]').forEach(el => {
    el.addEventListener('click', () => vscode.postMessage({
        type: el.dataset.action || 'select',
        index: Number(el.dataset.index)
    }));
});
window.addEventListener('message', event => {
    if (event.data.type === 'sessionEnded') {
        document.body.classList.add('ended');
    }
});
</script>
</body>
</html>`;
    }

    private stage(record: FrameRecord, overlay: Overlay): string {
        const { capture } = record;

        return `
<div class="stage">
  <header>
    <span class="reason ${record.reason}">${escapeHtml(record.reason)}</span>
    <span class="where">${escapeHtml(path.basename(record.file))}:${record.line}</span>
    ${record.elapsed ? `<span class="elapsed">${record.elapsed.toFixed(2)}s</span>` : ''}
    ${record.label ? `<code class="line">${escapeHtml(record.label)}</code>` : ''}
    ${record.text ? `<span class="text">${escapeHtml(record.text.split('\n')[0])}</span>` : ''}
  </header>
  <div class="shot">
    <div class="frame">
      <img src="${this.uri(capture.path)}" alt="Screen at the stop">
      ${overlay.html}
    </div>
  </div>
  ${this.diagnosisBlock(record, overlay)}
</div>`;
    }

    /**
     * The region the script searched and the best match found, drawn over the
     * screenshot. Seeing the two boxes apart is usually the whole explanation.
     */
    private diagnosisBlock(record: FrameRecord, overlay: Overlay): string {
        const { diagnosis } = record;

        if (!diagnosis) {
            if (!record.text || record.text.indexOf('FindFailed') === -1) {
                return '';
            }
            return `<div class="diagnose">
  <button data-action="diagnose" data-index="${record.capture.index}">
    Why did this fail?
  </button>
</div>`;
        }

        return `<div class="diagnosis">
  ${diagnosis.imagePath ? `<div class="pattern">
    <img src="${this.uri(diagnosis.imagePath)}" alt="Pattern searched for">
    <span>looking for</span>
  </div>` : ''}
  <div class="verdicts">${verdictsHtml(diagnosis)}</div>
  ${overlay.html ? `<div class="legend">
    ${diagnosis.region ? '<span><i class="swatch searched"></i>searched here</span>' : ''}
    <span><i class="swatch match"></i>best match</span>
  </div>` : ''}
</div>`;
    }

    private filmstrip(): string {
        if (this.frames.length === 0) {
            return '';
        }

        const cells = this.frames.map(record => `
  <button class="cell ${record.capture.index === this.selected ? 'on' : ''}"
          data-index="${record.capture.index}">
    <img src="${this.uri(record.capture.thumbnail ?? record.capture.path)}" alt="">
    <span>${record.capture.index}. ${escapeHtml(record.label ?? record.reason)}</span>
  </button>`).join('');

        return `<div class="strip">${cells}</div>`;
    }
}

const EMPTY_STATE = `
<div class="empty">
  <p>No frames yet.</p>
  <p class="hint">The screen is captured after each action the script takes, and
     whenever it stops.</p>
</div>`;

const STYLES = `
:root { color-scheme: light dark; }
body {
    margin: 0; padding: 0;
    font-family: var(--vscode-font-family);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    display: flex; flex-direction: column; height: 100vh;
}
body.ended .stage, body.ended .strip { opacity: 0.45; }
.stage { flex: 1; display: flex; flex-direction: column; min-height: 0; padding: 12px; gap: 10px; }
header { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.reason {
    text-transform: uppercase; font-size: 10px; letter-spacing: 0.08em;
    padding: 2px 6px; border-radius: 3px;
    background: var(--vscode-badge-background); color: var(--vscode-badge-foreground);
}
.reason.exception { background: var(--vscode-errorForeground); color: var(--vscode-editor-background); }
.reason.action { background: transparent; color: var(--vscode-descriptionForeground);
                 border: 1px solid var(--vscode-panel-border); }
.where { font-family: var(--vscode-editor-font-family); font-size: 12px; }
.text { color: var(--vscode-errorForeground); font-size: 12px; }
.shot { flex: 1; min-height: 0; overflow: auto; }
/* Shrink-wraps the image, so a box placed at a percentage lands on the picture
   rather than on the letterboxing around it. */
.frame {
    position: relative; display: inline-block; line-height: 0;
    border: 1px solid var(--vscode-panel-border);
}
.frame img { display: block; max-width: 100%; max-height: 62vh; }
.box { position: absolute; pointer-events: none; }
.box.searched { border: 2px dashed #4aa3ff; }
.box.match { border: 2px solid #f0c000; }
.box.match.outside { border-color: #ff9d3d; }
.legend { display: flex; gap: 12px; font-size: 11px; color: var(--vscode-descriptionForeground); }
.swatch { display: inline-block; width: 10px; height: 10px; margin-right: 4px; }
.swatch.searched { border: 2px dashed #4aa3ff; }
.swatch.match { border: 2px solid #f0c000; }
.verdicts { flex: 1; }
.verdict.elsewhere, .verdict.strong { color: #f0a030; }
.verdict.timing { color: #4aa3ff; }
.diagnose, .diagnosis { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.pattern { display: flex; flex-direction: column; align-items: center; gap: 4px; }
.pattern img { border: 1px solid var(--vscode-panel-border); max-height: 80px; }
.pattern span { font-size: 10px; opacity: 0.7; }
.verdict { margin: 0 0 4px; font-size: 13px; }
.verdict.none { color: var(--vscode-errorForeground); }
button {
    background: var(--vscode-button-background); color: var(--vscode-button-foreground);
    border: none; padding: 6px 12px; cursor: pointer; border-radius: 2px;
    font-family: inherit; font-size: 12px;
}
button:hover { background: var(--vscode-button-hoverBackground); }
.strip {
    display: flex; gap: 8px; overflow-x: auto; padding: 8px 12px;
    border-top: 1px solid var(--vscode-panel-border); flex: 0 0 auto;
}
.cell {
    background: none; border: 2px solid transparent; padding: 2px;
    display: flex; flex-direction: column; gap: 3px; align-items: center;
}
.cell.on { border-color: var(--vscode-focusBorder); }
.cell img { width: 120px; display: block; }
.cell span {
    font-size: 10px; color: var(--vscode-descriptionForeground);
    max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.elapsed { font-size: 11px; color: var(--vscode-descriptionForeground); }
.line {
    font-family: var(--vscode-editor-font-family); font-size: 11px;
    color: var(--vscode-descriptionForeground);
}
.empty { flex: 1; display: flex; flex-direction: column; justify-content: center;
         align-items: center; gap: 6px; color: var(--vscode-descriptionForeground); }
.hint { font-size: 12px; max-width: 380px; text-align: center; }
`;

/**
 * What the two searches mean, in the order that answers the question: was it in
 * the region at all, and if not, where was it really?
 */
function escapeHtml(text: string): string {
    return text.replace(/[&<>"']/g, char => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[char] as string));
}

function randomNonce(): string {
    let nonce = '';
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        nonce += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
    }
    return nonce;
}
