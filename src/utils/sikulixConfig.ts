import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { log } from './output';

export interface SikulixEnvironment {
    javaPath: string;
    jarPath: string;
    jvmArgs: string[];
    debugLevel: number;
}

interface JavaRuntime {
    javaPath: string;
    home: string;
    version: string;
    headful: boolean;
}

const JAVA_HOME_SETTING = /^\s*java\.home\s*=\s*(.+?)\s*$/m;
const JAVA_VERSION_SETTING = /^\s*java\.version\s*=\s*(.+?)\s*$/m;
const RELEASE_VERSION = /^JAVA_VERSION="?([^"\n]+)"?$/m;

// Present only in a headful JRE. Without it SikuliX cannot open a screen, and it fails
// silently: the JVM exits 1 having printed nothing unless -d 3 is in play.
const HEADFUL_MARKER = 'libawt_xawt.so';

// Where distributions install JVMs. Checked only when nothing is configured.
const JVM_ROOTS = ['/usr/lib/jvm', '/usr/java', '/opt/java'];

// SikuliX 2.0.5 predates the module-system tightening; on 24+ it warns that its native
// access will stop working, so an older runtime is preferred when there is a choice.
const PREFERRED_MAX_MAJOR = 21;

let resolvedJava: JavaRuntime | null = null;
let resolvedJavaFor: string | null = null;

/**
 * Resolves everything needed to launch SikuliX, prompting for the jar the first time.
 * Returns null when something is missing, having already reported it to the user.
 */
export async function resolveEnvironment(): Promise<SikulixEnvironment | null> {
    const config = vscode.workspace.getConfiguration('sikuliVS');

    const jarPath = await resolveJarPath(config);
    if (!jarPath) {
        return null;
    }

    const java = await resolveJava(config);
    if (!java) {
        return null;
    }

    return {
        javaPath: java.javaPath,
        jarPath,
        jvmArgs: config.get<string[]>('jvmArgs', []),
        debugLevel: config.get<number>('debugLevel', 0)
    };
}

let waylandWarningAccepted = false;

/**
 * Warns once per session before running on Wayland.
 *
 * SikuliX reaches the screen through `java.awt.Robot`. On Wayland that goes to the
 * desktop portal, which asks permission per capture and does not reuse the grant, so a
 * trivial script can raise hundreds of dialogs. Bypassing the portal is not an
 * alternative: an X11 client under XWayland cannot see the compositor's output and its
 * captures come back blank, which would silently stop every match from ever succeeding.
 */
export async function confirmDisplayServer(): Promise<boolean> {
    if (waylandWarningAccepted || !isWaylandSession()) {
        return true;
    }

    const choice = await vscode.window.showWarningMessage(
        'SikuliVS: This is a Wayland session. SikuliX asks the desktop portal for screen ' +
        'permission on every capture and never reuses the answer, so even a one-line script ' +
        'can raise hundreds of prompts. Log in to an X11 session for usable automation.',
        { modal: true },
        'Run Anyway'
    );

    waylandWarningAccepted = choice === 'Run Anyway';
    return waylandWarningAccepted;
}

function isWaylandSession(): boolean {
    return Boolean(process.env.WAYLAND_DISPLAY) || process.env.XDG_SESSION_TYPE === 'wayland';
}

/**
 * The configured jar, else one sitting in a workspace root, else ask.
 */
async function resolveJarPath(config: vscode.WorkspaceConfiguration): Promise<string | null> {
    const configured = config.get<string>('jarPath', '').trim();
    if (configured) {
        if (!fs.existsSync(configured)) {
            await vscode.window.showErrorMessage(
                `SikuliVS: sikuliVS.jarPath points at a file that does not exist: ${configured}`
            );
            return null;
        }
        return configured;
    }

    const discovered = findJarInWorkspace();
    if (discovered) {
        log(`[run] using discovered jar: ${discovered}`);
        return discovered;
    }

    return promptForJar(config);
}

/**
 * Looks for a `sikulix*.jar` at the top level of each workspace folder.
 */
function findJarInWorkspace(): string | null {
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
        const root = folder.uri.fsPath;
        let entries: string[];
        try {
            entries = fs.readdirSync(root);
        } catch {
            continue;
        }

        const jar = entries.find(name => /^sikulix.*\.jar$/i.test(name));
        if (jar) {
            return path.join(root, jar);
        }
    }

    return null;
}

async function promptForJar(config: vscode.WorkspaceConfiguration): Promise<string | null> {
    const choice = await vscode.window.showErrorMessage(
        'SikuliVS: No SikuliX jar configured. Running scripts needs sikulixapi-<version>.jar.',
        'Select Jar...'
    );
    if (choice !== 'Select Jar...') {
        return null;
    }

    const picked = await vscode.window.showOpenDialog({
        canSelectMany: false,
        openLabel: 'Use this jar',
        filters: { 'Java archive': ['jar'] }
    });
    if (!picked || picked.length === 0) {
        return null;
    }

    const jarPath = picked[0].fsPath;
    await config.update('jarPath', jarPath, vscode.ConfigurationTarget.Global);
    return jarPath;
}

/**
 * The Java runtime to launch SikuliX with, resolved the same way as the jar: take the
 * setting if there is one, otherwise find a usable runtime, otherwise ask.
 *
 * "Usable" means headful. The distribution default is often not: on Fedora the packaged
 * `java` is the headless build, so the runtime that works has to be looked for rather
 * than assumed.
 */
async function resolveJava(config: vscode.WorkspaceConfiguration): Promise<JavaRuntime | null> {
    const configured = config.get<string>('javaPath', '').trim();

    if (resolvedJava && resolvedJavaFor === configured) {
        return resolvedJava;
    }

    const runtime = configured
        ? await inspectJava(configured)
        : await findUsableJava();

    if (!runtime) {
        return promptForJava(config, configured);
    }

    if (!runtime.headful) {
        return reportHeadless(config, runtime);
    }

    log(`[run] java ${runtime.version} (${runtime.home})`);
    resolvedJava = runtime;
    resolvedJavaFor = configured;
    return runtime;
}

/**
 * JAVA_HOME and PATH first, since an explicitly chosen runtime beats a guess; installed
 * JVMs are only scanned when neither of those can open a screen.
 */
async function findUsableJava(): Promise<JavaRuntime | null> {
    const javaHome = process.env.JAVA_HOME;
    const preferred = [
        javaHome ? path.join(javaHome, 'bin', 'java') : null,
        'java'
    ].filter((candidate): candidate is string => candidate !== null);

    for (const candidate of preferred) {
        const runtime = await inspectJava(candidate);
        if (runtime?.headful) {
            return runtime;
        }
    }

    return discoverInstalledJava();
}

/**
 * Reads installed JVMs straight off disk — the release file gives the version and the
 * presence of the AWT library gives headfulness, so nothing has to be executed.
 */
function discoverInstalledJava(): JavaRuntime | null {
    const found: JavaRuntime[] = [];
    const seen = new Set<string>();

    for (const root of JVM_ROOTS) {
        let entries: string[];
        try {
            entries = fs.readdirSync(root);
        } catch {
            continue;   // Root does not exist on this machine
        }

        for (const entry of entries) {
            const home = realPath(path.join(root, entry));
            const javaPath = path.join(home, 'bin', 'java');
            if (seen.has(home) || !fs.existsSync(javaPath)) {
                continue;
            }
            seen.add(home);

            found.push({
                javaPath,
                home,
                version: readReleaseVersion(home),
                headful: fs.existsSync(path.join(home, 'lib', HEADFUL_MARKER))
            });
        }
    }

    const usable = found.filter(runtime => runtime.headful).sort(bySikulixPreference);
    return usable[0] ?? null;
}

/**
 * Runtimes SikuliX is happy with come first; beyond that, newer before older.
 */
function bySikulixPreference(a: JavaRuntime, b: JavaRuntime): number {
    const aSupported = majorVersion(a.version) <= PREFERRED_MAX_MAJOR;
    const bSupported = majorVersion(b.version) <= PREFERRED_MAX_MAJOR;

    if (aSupported !== bSupported) {
        return aSupported ? -1 : 1;
    }
    return majorVersion(b.version) - majorVersion(a.version);
}

function majorVersion(version: string): number {
    const parts = version.split('.');
    // Pre-9 runtimes report as 1.8.x, where the major version is the second part.
    const major = parts[0] === '1' ? parts[1] : parts[0];
    return parseInt(major, 10) || 0;
}

function readReleaseVersion(home: string): string {
    try {
        return RELEASE_VERSION.exec(fs.readFileSync(path.join(home, 'release'), 'utf8'))?.[1]
            ?? 'unknown';
    } catch {
        return 'unknown';
    }
}

function realPath(candidate: string): string {
    try {
        return fs.realpathSync(candidate);
    } catch {
        return candidate;
    }
}

/**
 * Asks a runtime about itself. Used for anything named rather than discovered, since a
 * bare `java` has to be located on PATH before its home is known.
 */
async function inspectJava(javaPath: string): Promise<JavaRuntime | null> {
    let settings: string;
    try {
        settings = await javaSettings(javaPath);
    } catch {
        return null;
    }

    const home = JAVA_HOME_SETTING.exec(settings)?.[1] ?? path.dirname(path.dirname(javaPath));
    return {
        javaPath,
        home,
        version: JAVA_VERSION_SETTING.exec(settings)?.[1] ?? 'unknown',
        headful: fs.existsSync(path.join(home, 'lib', HEADFUL_MARKER))
    };
}

function javaSettings(javaPath: string): Promise<string> {
    return new Promise((resolve, reject) => {
        execFile(javaPath, ['-XshowSettings:properties', '-version'], (error, stdout, stderr) => {
            if (error) {
                return reject(error);
            }
            resolve(`${stderr}\n${stdout}`);   // -XshowSettings reports on stderr
        });
    });
}

async function reportHeadless(
    config: vscode.WorkspaceConfiguration,
    runtime: JavaRuntime
): Promise<JavaRuntime | null> {
    const choice = await vscode.window.showErrorMessage(
        `SikuliVS: The Java runtime at ${runtime.home} is headless (no ${HEADFUL_MARKER}), ` +
        'so SikuliX cannot access the screen. Install a full JDK, e.g. "java-17-openjdk".',
        'Select Java...'
    );

    return choice === 'Select Java...' ? pickJava(config) : null;
}

async function promptForJava(
    config: vscode.WorkspaceConfiguration,
    configured: string
): Promise<JavaRuntime | null> {
    const message = configured
        ? `SikuliVS: Could not run java at "${configured}".`
        : 'SikuliVS: No Java runtime that can access the screen was found. SikuliX needs a headful JDK.';

    const choice = await vscode.window.showErrorMessage(message, 'Select Java...');
    return choice === 'Select Java...' ? pickJava(config) : null;
}

/**
 * Falls back to picking the `java` binary by hand, saving it so the prompt is one-time.
 */
async function pickJava(config: vscode.WorkspaceConfiguration): Promise<JavaRuntime | null> {
    const picked = await vscode.window.showOpenDialog({
        canSelectMany: false,
        openLabel: 'Use this java',
        defaultUri: vscode.Uri.file(JVM_ROOTS[0])
    });
    if (!picked || picked.length === 0) {
        return null;
    }

    const runtime = await inspectJava(picked[0].fsPath);
    if (!runtime) {
        await vscode.window.showErrorMessage(
            `SikuliVS: ${picked[0].fsPath} is not a Java runtime.`
        );
        return null;
    }

    if (!runtime.headful) {
        // Saving it would only make the next run fail the same way, with the setting to
        // undo first.
        await vscode.window.showErrorMessage(
            `SikuliVS: ${runtime.home} is headless (no ${HEADFUL_MARKER}) and cannot run SikuliX.`
        );
        return null;
    }

    await config.update('javaPath', runtime.javaPath, vscode.ConfigurationTarget.Global);
    log(`[run] java ${runtime.version} (${runtime.home})`);

    resolvedJava = runtime;
    resolvedJavaFor = runtime.javaPath;
    return runtime;
}
