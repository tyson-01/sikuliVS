import { Rect } from './findFailed';

export interface Match {
    score: number;
    rect: Rect;
}

export interface Diagnosis {
    imagePath: string | null;
    required: number;
    /** Best match inside the region the script actually searched. */
    inRegion: Match | null;
    /** Best match anywhere on the captured screen. */
    overall: Match | null;
    region: Rect | null;
    /** SikuliX's own message, kept so an unreadable one can still be shown. */
    rawMessage?: string;
}

/**
 * Places a box onto a captured frame as percentages, so it stays put when the
 * image is scaled to fit the panel. Coordinates are relative to the screenshot,
 * which is a whole screen, so there is no origin to subtract.
 */
export function boxStyle(rect: Rect, bounds: { w: number; h: number }): string {
    const percent = (value: number, extent: number) => (extent > 0 ? (value / extent) * 100 : 0);

    return [
        `left:${percent(rect.x, bounds.w)}%`,
        `top:${percent(rect.y, bounds.h)}%`,
        `width:${percent(rect.w, bounds.w)}%`,
        `height:${percent(rect.h, bounds.h)}%`
    ].join('; ');
}

/**
 * The strongest candidate either search found, and whether it lies outside the
 * region the script was looking at.
 */
function bestMatch(diagnosis: Diagnosis): { rect: Rect; outside: boolean } | null {
    const { inRegion, overall } = diagnosis;

    if (inRegion && (!overall || inRegion.score >= overall.score)) {
        return { rect: inRegion.rect, outside: false };
    }
    return overall ? { rect: overall.rect, outside: true } : null;
}

export interface Overlay {
    html: string;
    /** Rules for the page's own <style> block - see why below. */
    css: string;
}

/**
 * The region searched and the best match, drawn over the screenshot. Seeing the
 * two boxes apart is usually the whole explanation for a failed search.
 *
 * Positions are emitted as CSS rules rather than inline `style` attributes: a
 * webview's content policy authorises a <style> element by nonce, but a nonce
 * does not cover inline style attributes, so inline positions are dropped and
 * every box collapses to nothing. That is not a hypothetical; it is what made
 * these invisible while the legend beside them rendered perfectly.
 */
export function buildOverlay(
    diagnosis: Diagnosis | undefined,
    bounds: { w: number; h: number }
): Overlay {
    if (!diagnosis) {
        return { html: '', css: '' };
    }

    const boxes: string[] = [];
    const rules: string[] = [];

    const place = (id: string, classes: string, rect: Rect) => {
        boxes.push(`<div class="box ${classes}" id="${id}"></div>`);
        rules.push(`#${id} { ${boxStyle(rect, bounds)} }`);
    };

    if (diagnosis.region) {
        place('overlay-searched', 'searched', diagnosis.region);
    }

    const best = bestMatch(diagnosis);
    if (best) {
        place('overlay-match', `match${best.outside ? ' outside' : ''}`, best.rect);
    }

    return { html: boxes.join('\n      '), css: rules.join('\n') };
}

/**
 * What the two searches mean, in the order that answers the question: was it in
 * the region at all, and if not, where was it really?
 */
export function verdictsHtml(diagnosis: Diagnosis): string {
    const required = diagnosis.required.toFixed(2);
    const { inRegion, overall } = diagnosis;
    const lines: string[] = [];

    if (inRegion && inRegion.score >= diagnosis.required) {
        // It matches now but did not then, so the screen moved on between the
        // search giving up and the capture: a timing problem, not a matching one.
        lines.push(
            `<p class="verdict timing">It matches <strong>now</strong> at ` +
            `${inRegion.score.toFixed(2)}, inside the region searched. The screen ` +
            'probably changed after the search gave up.</p>'
        );
    } else if (inRegion) {
        lines.push(
            `<p class="verdict">Inside the region searched, the closest was ` +
            `<strong>${inRegion.score.toFixed(2)}</strong>, needed <strong>${required}</strong>.</p>`
        );
    } else if (diagnosis.region) {
        lines.push(
            '<p class="verdict none">Nothing inside the region searched resembled ' +
            'this image at all.</p>'
        );
    }

    if (overall && (!inRegion || overall.score > inRegion.score + 0.01)) {
        lines.push(
            `<p class="verdict elsewhere">Best match on screen scored ` +
            `<strong>${overall.score.toFixed(2)}</strong> at ` +
            `(${overall.rect.x}, ${overall.rect.y})` +
            `${diagnosis.region ? ' - outside the region searched' : ''}.</p>`
        );
    }

    if (!overall && !inRegion) {
        lines.push(
            '<p class="verdict none">Nothing resembling this image was found anywhere ' +
            'on the captured screen - so there is nothing to outline. If it should have ' +
            'been visible, the editor may have been covering it when the shot was taken.</p>'
        );
    }

    return lines.join('\n');
}
