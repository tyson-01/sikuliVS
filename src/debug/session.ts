import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { runSikulixScript, SikulixRun } from '../bridge/sikulixBridge';
import { resolveEnvironment, confirmDisplayServer } from '../utils/sikulixConfig';
import { resolveScriptTarget } from '../utils/scriptTarget';
import { ScriptErrorParser } from '../utils/runErrors';
import {
    clearRunDiagnostics,
    publishKnownError,
    publishScriptDiagnostics
} from '../utils/runDiagnostics';
import { log } from '../utils/output';
import { acquireRun, releaseRun, runHolder } from '../utils/runLock';
import { AgentChannel, AgentEvent } from './agentChannel';
import { executableLine, removeLaunchDir, writeLaunchDir } from './launcher';

// The script runs on one Jython thread, so the session reports exactly one.
const THREAD_ID = 1;
const THREAD_NAME = 'SikuliX script';

// How long SikuliX gets to boot the JVM and dial back in before the launch is called off.
const CONNECT_TIMEOUT_MS = 60000;

interface DapMessage {
    seq: number;
    type: string;
}

interface DapRequest extends DapMessage {
    type: 'request';
    command: string;
    arguments?: any;
}

interface AgentFrame {
    id: number;
    name: string;
    file: string;
    line: number;
}

/**
 * The debug adapter, run inline in the extension host.
 *
 * Translates between VS Code's Debug Adapter Protocol and the much smaller command set
 * the Jython agent understands. The agent does the actual tracing; everything here is
 * bookkeeping around a launch that has to survive a JVM starting up.
 */
export class SikulixDebugSession implements vscode.DebugAdapter {
    private readonly sendEmitter = new vscode.EventEmitter<vscode.DebugProtocolMessage>();
    readonly onDidSendMessage = this.sendEmitter.event;

    private readonly channel = new AgentChannel((event) => this.onAgentEvent(event));
    private readonly parser = new ScriptErrorParser();

    private outgoingSeq = 0;
    private run: SikulixRun | null = null;
    private launcher: string | null = null;
    private pyFile = '';

    private agentReady = false;
    private reportedFailure: { file: string; line: number; column?: number; message: string } | null = null;
    private configurationDone = false;
    private started = false;
    private terminated = false;

    private readonly breakpoints = new Map<string, { line: number; condition?: string }[]>();
    private breakOnRaised = false;

    private holdsRunLock = false;

    constructor(private readonly extensionPath: string) {}

    handleMessage(message: vscode.DebugProtocolMessage): void {
        void this.dispatch(message as DapRequest);
    }

    dispose(): void {
        this.stopEverything();
    }

    // -- protocol ----------------------------------------------------------

    private async dispatch(request: DapRequest): Promise<void> {
        if (request.type !== 'request') {
            return;
        }

        try {
            await this.handle(request);
        } catch (err) {
            this.fail(request, `${err instanceof Error ? err.message : err}`);
        }
    }

    private async handle(request: DapRequest): Promise<void> {
        const args = request.arguments ?? {};

        switch (request.command) {
            case 'initialize':
                return this.respond(request, this.capabilities(), () => this.event('initialized'));

            case 'launch':
                return this.launch(request);

            case 'setBreakpoints':
                return this.setBreakpoints(request);

            case 'setExceptionBreakpoints':
                // Sent before the agent is up, so it is kept and replayed at start.
                this.breakOnRaised = (args.filters ?? []).includes('raised');
                this.channel.notify('setExceptionBreakpoints', { raised: this.breakOnRaised });
                return this.respond(request, {});

            case 'configurationDone':
                this.configurationDone = true;
                this.respond(request, {});
                return this.startIfReady();

            case 'threads':
                return this.respond(request, {
                    threads: [{ id: THREAD_ID, name: THREAD_NAME }]
                });

            case 'stackTrace':
                return this.stackTrace(request);

            case 'scopes':
                return this.scopes(request);

            case 'variables':
                return this.variables(request);

            case 'evaluate':
                return this.evaluate(request);

            case 'continue':
                this.channel.notify('continue');
                return this.respond(request, { allThreadsContinued: true });

            case 'next':
            case 'stepIn':
            case 'stepOut':
            case 'pause':
                this.channel.notify(request.command);
                return this.respond(request, {});

            case 'terminate':
            case 'disconnect':
                this.respond(request, {});
                return this.stopEverything();

            default:
                return this.respond(request, {});
        }
    }

    private capabilities(): Record<string, unknown> {
        return {
            supportsConfigurationDoneRequest: true,
            supportsConditionalBreakpoints: true,
            supportsEvaluateForHovers: true,
            supportsTerminateRequest: true,
            supportsDelayedStackTraceLoading: false,
            exceptionBreakpointFilters: [{
                filter: 'raised',
                label: 'Raised exceptions',
                description: 'Break wherever an exception is raised, including FindFailed.',
                default: false
            }]
        };
    }

    // -- launching ---------------------------------------------------------

    private async launch(request: DapRequest): Promise<void> {
        const program = request.arguments?.program;
        if (typeof program !== 'string' || !fs.existsSync(program)) {
            return this.failLaunch(
                request,
                `SikuliVS: No script to debug (${program ?? 'none given'}).`
            );
        }

        if (!acquireRun('debug')) {
            return this.fail(
                request,
                `SikuliVS: A script is already ${runHolder() === 'debug' ? 'being debugged' : 'running'}.`
            );
        }
        this.holdsRunLock = true;

        const environment = await resolveEnvironment();
        if (!environment) {
            return this.failLaunch(request, 'SikuliVS: SikuliX is not configured.');
        }

        if (!(await confirmDisplayServer())) {
            return this.failLaunch(request, 'SikuliVS: Run cancelled.');
        }

        const script = resolveScriptTarget(program);
        this.pyFile = script.pyFile;
        clearRunDiagnostics();

        const port = await this.channel.listen();
        this.launcher = writeLaunchDir({
            port,
            script: script.pyFile,
            bundle: path.dirname(script.pyFile),
            roots: this.userRoots(script.pyFile),
            stopOnEntry: request.arguments?.stopOnEntry === true
        }, this.extensionPath);

        log(`[debug] ${script.target}`);
        this.run = runSikulixScript(
            { ...environment, target: this.launcher, cwd: script.cwd },
            (line) => this.onScriptOutput(line)
        );

        this.run.exited.then(
            (code) => this.onProcessExit(code),
            (err) => {
                this.output(`SikuliVS: could not start SikuliX: ${err}\n`, 'stderr');
                this.onProcessExit(-1);
            }
        );

        this.respond(request, {});
        this.watchForConnection();
    }

    /**
     * Folders whose files the debugger treats as the user's own: breakpoints are only
     * honoured there, and stepping never descends into SikuliX's own library.
     */
    private userRoots(pyFile: string): string[] {
        const roots = (vscode.workspace.workspaceFolders ?? []).map(folder => folder.uri.fsPath);
        roots.push(path.dirname(pyFile));
        return [...new Set(roots)];
    }

    private watchForConnection(): void {
        const timer = setTimeout(() => {
            if (!this.agentReady && !this.terminated) {
                this.output(
                    'SikuliVS: SikuliX did not connect to the debugger. Raise ' +
                    'sikuliVS.debugLevel to 3 and try again to see where it stopped.\n',
                    'stderr'
                );
                void this.stopEverything();
            }
        }, CONNECT_TIMEOUT_MS);
        timer.unref?.();
    }

    private async startIfReady(): Promise<void> {
        if (this.started || !this.agentReady || !this.configurationDone) {
            return;
        }
        this.started = true;

        for (const [file, lines] of this.breakpoints) {
            await this.pushBreakpoints(file, lines);
        }
        await this.channel.request('setExceptionBreakpoints', { raised: this.breakOnRaised })
            .catch(() => undefined);
        this.channel.notify('start');
    }

    // -- breakpoints -------------------------------------------------------

    private async setBreakpoints(request: DapRequest): Promise<void> {
        const file = request.arguments?.source?.path as string | undefined;
        if (!file) {
            return this.respond(request, { breakpoints: [] });
        }

        const source = readLines(file);
        const requested = (request.arguments?.breakpoints ?? []) as
            { line: number; condition?: string }[];

        const placed = requested.map(breakpoint => ({
            line: executableLine(source, breakpoint.line),
            condition: breakpoint.condition
        }));

        this.breakpoints.set(file, placed);
        if (this.started) {
            await this.pushBreakpoints(file, placed);
        }

        this.respond(request, {
            breakpoints: placed.map(breakpoint => ({ verified: true, line: breakpoint.line }))
        });
    }

    private async pushBreakpoints(
        file: string,
        lines: { line: number; condition?: string }[]
    ): Promise<void> {
        if (!this.channel.connected) {
            return;
        }
        await this.channel.request('setBreakpoints', { file, breakpoints: lines })
            .catch(() => undefined);
    }

    // -- inspection --------------------------------------------------------

    private async stackTrace(request: DapRequest): Promise<void> {
        const body = await this.channel.request('stackTrace');
        const frames = (body?.frames ?? []) as AgentFrame[];

        this.respond(request, {
            totalFrames: frames.length,
            stackFrames: frames.map(frame => ({
                id: frame.id,
                name: frame.name,
                line: frame.line,
                column: 1,
                source: { name: path.basename(frame.file), path: frame.file }
            }))
        });
    }

    private async scopes(request: DapRequest): Promise<void> {
        const body = await this.channel.request('scopes', { frameId: request.arguments.frameId });
        const scopes = (body?.scopes ?? []) as { name: string; ref: number; expensive: boolean }[];

        this.respond(request, {
            scopes: scopes.map(scope => ({
                name: scope.name,
                variablesReference: scope.ref,
                expensive: scope.expensive
            }))
        });
    }

    private async variables(request: DapRequest): Promise<void> {
        const body = await this.channel.request('variables', {
            ref: request.arguments.variablesReference
        });

        this.respond(request, { variables: (body?.variables ?? []).map(toDapVariable) });
    }

    private async evaluate(request: DapRequest): Promise<void> {
        const body = await this.channel.request('evaluate', {
            frameId: request.arguments.frameId,
            expression: request.arguments.expression
        });

        this.respond(request, {
            result: body?.value ?? '',
            type: body?.type,
            variablesReference: body?.ref ?? 0
        });
    }

    // -- agent and process events ------------------------------------------

    private onAgentEvent(event: AgentEvent): void {
        switch (event.event) {
            case 'ready':
                this.agentReady = true;
                void this.startIfReady();
                return;

            case 'stopped':
                this.event('stopped', {
                    reason: event.reason,
                    description: event.text ?? undefined,
                    text: event.text ?? undefined,
                    threadId: THREAD_ID,
                    allThreadsStopped: true
                });
                return;

            case 'continued':
                this.event('continued', { threadId: THREAD_ID, allThreadsContinued: true });
                return;

            case 'error':
                // The agent knows which file and line actually failed; SikuliX only
                // knows it was pointed at the generated launcher.
                this.reportedFailure = {
                    file: String(event.file),
                    line: Number(event.line),
                    column: typeof event.column === 'number' ? event.column : undefined,
                    message: String(event.message)
                };
                return;

            case 'agentError':
                this.output(`SikuliVS debugger: ${event.text}\n`, 'stderr');
                return;

            default:
                return;
        }
    }

    private onScriptOutput(line: string): void {
        log(line);
        this.parser.push(line);
        this.output(`${line}\n`, line.startsWith('[error]') ? 'stderr' : 'stdout');
    }

    private onProcessExit(code: number): void {
        if (this.terminated) {
            return;
        }
        this.terminated = true;

        const failure = this.reportedFailure;
        if (failure) {
            publishKnownError(failure.file, failure.line, failure.column, failure.message);
        } else {
            publishScriptDiagnostics(this.pyFile, this.parser.finish());
        }
        log(`[debug] finished with exit code ${code}`);

        this.event('exited', { exitCode: code });
        this.event('terminated');
        this.cleanUp();
    }

    private async stopEverything(): Promise<void> {
        if (this.run && !this.terminated) {
            this.channel.notify('disconnect');
            this.run.stop();
            return;     // The exit handler finishes the session.
        }

        if (!this.terminated) {
            this.terminated = true;
            this.event('terminated');
        }
        this.cleanUp();
    }

    private cleanUp(): void {
        this.channel.dispose();
        if (this.launcher) {
            removeLaunchDir(this.launcher);
            this.launcher = null;
        }
        if (this.holdsRunLock) {
            this.holdsRunLock = false;
            releaseRun();
        }
    }

    // -- message plumbing --------------------------------------------------

    private respond(request: DapRequest, body: unknown, then?: () => void): void {
        this.send({
            seq: ++this.outgoingSeq,
            type: 'response',
            request_seq: request.seq,
            command: request.command,
            success: true,
            body
        });
        then?.();
    }

    /** A launch that never started still has to give back what it took. */
    private failLaunch(request: DapRequest, message: string): void {
        this.fail(request, message);
        this.terminated = true;
        this.event('terminated');
        this.cleanUp();
    }

    private fail(request: DapRequest, message: string): void {
        this.send({
            seq: ++this.outgoingSeq,
            type: 'response',
            request_seq: request.seq,
            command: request.command,
            success: false,
            message
        });
    }

    private event(event: string, body?: unknown): void {
        this.send({ seq: ++this.outgoingSeq, type: 'event', event, body });
    }

    private output(text: string, category: 'stdout' | 'stderr'): void {
        this.event('output', { category, output: text });
    }

    private send(message: unknown): void {
        this.sendEmitter.fire(message as vscode.DebugProtocolMessage);
    }
}

interface AgentVariable {
    name: string;
    value: string;
    type: string;
    ref: number;
}

function toDapVariable(variable: AgentVariable): Record<string, unknown> {
    return {
        name: variable.name,
        value: variable.value,
        type: variable.type,
        variablesReference: variable.ref
    };
}

function readLines(file: string): string[] {
    try {
        return fs.readFileSync(file, 'utf8').split(/\r?\n/);
    } catch {
        return [];
    }
}
