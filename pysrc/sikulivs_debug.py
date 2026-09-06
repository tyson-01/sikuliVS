# -*- coding: utf-8 -*-
"""
Debug agent for SikuliVS, running inside SikuliX's Jython interpreter.

Speaks newline-delimited JSON over a TCP socket to the debug adapter in the
extension. The adapter listens; this connects out, so nothing has to be
guessed about ports on the SikuliX side.

Jython 2.7 only - no f-strings, no Python 3 syntax.
"""

from __future__ import with_statement

import os
import sys
import json
import socket
import threading
import traceback

# Reasons reported with a `stopped` event, mirroring the DAP names.
BREAKPOINT = 'breakpoint'
STEP = 'step'
ENTRY = 'entry'
PAUSE = 'pause'
EXCEPTION = 'exception'

# Members shown for SikuliX objects, most specific type first. Deliberately
# a fixed list: reading a Region's `image` or `lastScreenImage` captures the
# screen, which a variables pane must never do on its own.
_SIKULI_TYPES = [
    ('Match', ['x', 'y', 'w', 'h', 'getScore()', 'target', 'name']),
    ('Screen', ['x', 'y', 'w', 'h', 'ID']),
    ('Region', ['x', 'y', 'w', 'h', 'center', 'lastMatch', 'name']),
    ('Location', ['x', 'y']),
    ('Pattern', ['filename', 'getSimilar()', 'getTargetOffset()']),
]

MAX_CHILDREN = 500


class AgentError(Exception):
    """A failure worth reporting as a plain message rather than a traceback."""

# Stepping modes.
RUN = 0
STEP_IN = 1
STEP_OVER = 2
STEP_OUT = 3


def launch(port, script, bundle, roots, stop_on_entry, script_globals):
    """
    Runs `script` under the debugger. Returns the exit code the runner should
    report; raises whatever the script raised so SikuliX still reports it.
    """
    agent = _Agent(port, script, roots)
    agent.connect()
    try:
        agent.run(script, bundle, stop_on_entry, script_globals)
    finally:
        agent.close()


class _Agent(object):
    def __init__(self, port, script, roots):
        self.port = port
        self.script = _norm(script)
        self.roots = [_norm(root) for root in roots]

        self.sock = None
        self.send_lock = threading.Lock()
        self.alive = True

        # Set of user files, decided lazily per filename seen by the tracer.
        self.is_user_file = {}

        self.breakpoints = {}          # file -> {line: condition or None}
        self.resume = threading.Event()
        self.started = threading.Event()
        self.pause_requested = False
        self.mode = RUN
        self.step_depth = 0
        self.depth = 0
        self.stop_on_exception = False
        self.last_exception = None
        self.entry_pending = False

        # Only valid while suspended.
        self.frames = {}               # frame id -> frame
        self.frame_order = []
        self.variables = {}            # handle -> object
        self.next_handle = 1
        self.suspended = False

        # Names the script header left in the interpreter globals, so the
        # Globals scope can show the script's own names rather than all of
        # SikuliX's exports.
        self.preset_globals = set()
        self.script_globals = {}

        self.prev_trace = None

    # -- transport ---------------------------------------------------------

    def connect(self):
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.sock.connect(('127.0.0.1', self.port))
        reader = threading.Thread(target=self._read_loop)
        reader.setDaemon(True)
        reader.start()

    def close(self):
        self.alive = False
        self.resume.set()
        try:
            if self.sock is not None:
                self.sock.close()
        except Exception:
            pass

    def send(self, message):
        if self.sock is None:
            return
        data = json.dumps(message) + '\n'
        with self.send_lock:
            try:
                self.sock.sendall(data.encode('utf-8'))
            except Exception:
                self.alive = False

    def _read_loop(self):
        buffered = ''
        while self.alive:
            try:
                chunk = self.sock.recv(8192)
            except Exception:
                break
            if not chunk:
                break
            buffered += chunk.decode('utf-8')
            while '\n' in buffered:
                line, buffered = buffered.split('\n', 1)
                if line.strip():
                    self._dispatch(json.loads(line))

        # The adapter went away: never leave the script frozen at a breakpoint.
        self.alive = False
        self.resume.set()
        self.started.set()

    def _dispatch(self, request):
        seq = request.get('seq')
        command = request.get('command')
        handler = getattr(self, '_cmd_' + str(command), None)
        body = None
        error = None

        if handler is None:
            error = 'unknown command: %s' % command
        else:
            try:
                body = handler(request)
            except AgentError, failure:
                error = str(failure)
            except Exception:
                error = traceback.format_exc()

        if seq is not None:
            self.send({'id': seq, 'body': body, 'error': error})

    # -- commands ----------------------------------------------------------

    def _cmd_setBreakpoints(self, request):
        path = _norm(request['file'])
        lines = {}
        for entry in request.get('breakpoints', []):
            lines[int(entry['line'])] = entry.get('condition') or None
        self.breakpoints[path] = lines
        return {'lines': sorted(lines.keys())}

    def _cmd_setExceptionBreakpoints(self, request):
        self.stop_on_exception = bool(request.get('raised'))
        return {}

    def _cmd_continue(self, _request):
        self.mode = RUN
        self._release()
        return {}

    def _cmd_next(self, _request):
        self.mode = STEP_OVER
        self.step_depth = self.depth
        self._release()
        return {}

    def _cmd_stepIn(self, _request):
        self.mode = STEP_IN
        self._release()
        return {}

    def _cmd_stepOut(self, _request):
        self.mode = STEP_OUT
        self.step_depth = self.depth
        self._release()
        return {}

    def _cmd_pause(self, _request):
        self.pause_requested = True
        return {}

    def _cmd_stackTrace(self, _request):
        frames = []
        for frame_id in self.frame_order:
            frame = self.frames[frame_id]
            frames.append({
                'id': frame_id,
                'name': _frame_name(frame),
                'file': frame.f_code.co_filename,
                'line': frame.f_lineno
            })
        return {'frames': frames}

    def _cmd_scopes(self, request):
        frame = self.frames.get(request['frameId'])
        if frame is None:
            return {'scopes': []}

        scopes = []
        if frame.f_code.co_name == '<module>':
            # At module level f_locals is the interpreter namespace, which is
            # mostly SikuliX's own exports; only the script's names are useful.
            scopes.append(self._scope('Script', self._script_names(frame.f_locals)))
        else:
            scopes.append(self._scope('Locals', dict(frame.f_locals)))
            scopes.append(self._scope('Script', self._script_names(frame.f_globals)))
        return {'scopes': scopes}

    def _scope(self, name, names):
        return {'name': name, 'ref': self._handle(_Scope(names)), 'expensive': False}

    def _script_names(self, namespace):
        return dict(
            (name, value) for name, value in namespace.items()
            if name not in self.preset_globals and not name.startswith('__')
        )

    def _cmd_variables(self, request):
        target = self.variables.get(request['ref'])
        if target is None:
            return {'variables': []}
        return {'variables': self._children(target)}

    def _cmd_evaluate(self, request):
        frame = self.frames.get(request.get('frameId'))
        if frame is None:
            frame = self.frames.get(self.frame_order[0]) if self.frame_order else None
        if frame is None:
            raise AgentError('The script is not suspended.')

        expression = request['expression']
        try:
            value = eval(expression, frame.f_globals, frame.f_locals)
        except SyntaxError:
            try:
                exec(expression, frame.f_globals, frame.f_locals)
            except Exception:
                raise AgentError(_current_exception_text())
            value = None
        except Exception:
            # A failed watch expression is an everyday event; the message alone
            # reads better in the watch pane than a traceback through the agent.
            raise AgentError(_current_exception_text())
        return self._describe('', value)

    def _cmd_start(self, _request):
        self.started.set()
        return {}

    def _cmd_disconnect(self, _request):
        self.alive = False
        self.started.set()
        self._release()
        return {}

    def _release(self):
        self.pause_requested = False
        self.resume.set()

    # -- variables ---------------------------------------------------------

    def _handle(self, obj):
        handle = self.next_handle
        self.next_handle += 1
        self.variables[handle] = obj
        return handle

    def _describe(self, name, value):
        described = {'name': name, 'value': _repr(value), 'type': _type_name(value), 'ref': 0}
        if self._expandable(value):
            described['ref'] = self._handle(value)
        return described

    def _expandable(self, value):
        if isinstance(value, (dict, list, tuple, set, frozenset)):
            return len(value) > 0
        if self._sikuli_members(value) is not None:
            return True
        return hasattr(value, '__dict__') and len(getattr(value, '__dict__')) > 0

    def _sikuli_members(self, value):
        """
        The members worth showing for a SikuliX object, or None if it is not
        one. Reading arbitrary attributes off these is not safe: a Region's
        `image` property grabs the screen, so only known-inert members are
        ever touched.
        """
        for name, members in _SIKULI_TYPES:
            cls = self.script_globals.get(name)
            try:
                if cls is not None and isinstance(value, cls):
                    return members
            except TypeError:
                continue    # Not a class in this namespace.
        return None

    def _children(self, target):
        if isinstance(target, _Scope):
            pairs = sorted(target.names.items())
            return [self._describe(name, value) for name, value in pairs[:MAX_CHILDREN]]

        if isinstance(target, dict):
            pairs = sorted(target.items(), key=lambda pair: _repr(pair[0]))
            return [self._describe(_repr(key), value) for key, value in pairs[:MAX_CHILDREN]]

        if isinstance(target, (list, tuple)):
            return [self._describe('[%d]' % index, value)
                    for index, value in enumerate(target[:MAX_CHILDREN])]

        if isinstance(target, (set, frozenset)):
            return [self._describe('{%d}' % index, value)
                    for index, value in enumerate(list(target)[:MAX_CHILDREN])]

        members = self._sikuli_members(target)
        if members is not None:
            return self._member_children(target, members)

        attributes = getattr(target, '__dict__', {})
        return [self._describe(name, value)
                for name, value in sorted(attributes.items())[:MAX_CHILDREN]]

    def _member_children(self, target, members):
        children = []
        for member in members:
            try:
                if member.endswith('()'):
                    value = getattr(target, member[:-2])()
                    name = member[:-2]
                else:
                    value = getattr(target, member)
                    name = member
            except Exception:
                continue    # Not on this SikuliX version, or not readable here.
            children.append(self._describe(name, value))
        return children

    # -- tracing -----------------------------------------------------------

    def run(self, script, bundle, stop_on_entry, script_globals):
        if bundle:
            script_globals['setBundlePath'](bundle)

        # Reproduce what SikuliX sets up for a directly run script, so that
        # sibling imports and sys.argv look the same as an undebugged run.
        sys.path[0] = os.path.dirname(script)
        sys.argv = [script]

        self.script_globals = script_globals
        self.preset_globals = set(script_globals.keys())
        self.prev_trace = sys.gettrace()

        # Nothing is executed until the adapter has sent the breakpoints it
        # collected while the session was starting.
        self.send({'event': 'ready'})
        while not self.started.is_set() and self.alive:
            self.started.wait(0.2)

        if stop_on_entry:
            self.mode = STEP_IN
            self.entry_pending = True

        sys.settrace(self._trace)
        try:
            execfile(script, script_globals)
        except SystemExit:
            raise
        except:
            # SikuliX blames the generated launcher for the failure, since that
            # is the file it was pointed at. Say where it really happened.
            self._report_failure()
            raise
        finally:
            sys.settrace(self.prev_trace)
            self.send({'event': 'exited'})

    def _report_failure(self):
        value, tb = sys.exc_info()[1:]
        location = self._failure_location(value, tb)
        if location is None:
            return

        filename, line, column = location
        message = value.msg if isinstance(value, SyntaxError) else _current_exception_text()
        self.send({
            'event': 'error',
            'file': filename,
            'line': line,
            'column': column,
            'message': 'SyntaxError: %s' % message if isinstance(value, SyntaxError) else message
        })

    def _failure_location(self, value, tb):
        """The deepest frame in the user's own code, or where it failed to compile."""
        if isinstance(value, SyntaxError) and value.filename:
            return (value.filename, value.lineno or 0, value.offset)

        deepest = None
        while tb is not None:
            filename = tb.tb_frame.f_code.co_filename
            if self._is_user(filename):
                deepest = (filename, tb.tb_lineno, None)
            tb = tb.tb_next
        return deepest

    def _trace(self, frame, event, arg):
        """
        Global trace function: called on every frame entry. Returns the local
        tracer that then receives that frame's line, return and exception
        events, or None to leave the frame untraced.
        """
        chained = None
        # SikuliX installs its own tracer to implement abort; keep it running
        # so the stop button still works while the debugger is attached.
        if self.prev_trace is not None:
            chained = self.prev_trace(frame, event, arg)

        if not self.alive or not self._is_user(frame.f_code.co_filename):
            # Library frame: leave it entirely to SikuliX's tracer, so neither
            # breakpoints nor stepping ever descend into SikuliX itself.
            return chained

        self.depth += 1
        return _LocalTracer(self, chained).trace

    def _trace_user(self, frame, event, arg):
        if event == 'return':
            self.depth -= 1
            return

        if event == 'exception':
            # The same raise is reported once where it happened and again as it
            # unwinds through the frame; one stop per exception is enough.
            if self.stop_on_exception and arg[1] is not self.last_exception:
                self.last_exception = arg[1]
                self._suspend(frame, EXCEPTION, _exception_text(arg))
            return

        if event != 'line':
            return

        if self.pause_requested:
            self._suspend(frame, PAUSE)
            return

        condition = self._breakpoint_at(frame)
        if condition is not None and (
            condition is True or self._condition_holds(frame, condition)
        ):
            self._suspend(frame, BREAKPOINT)
            return

        if self._should_step():
            reason = STEP
            if self.entry_pending:
                self.entry_pending = False
                reason = ENTRY
            self._suspend(frame, reason)

    def _breakpoint_at(self, frame):
        lines = self.breakpoints.get(_norm(frame.f_code.co_filename))
        if not lines or frame.f_lineno not in lines:
            return None
        return lines[frame.f_lineno] or True

    def _condition_holds(self, frame, condition):
        try:
            return bool(eval(condition, frame.f_globals, frame.f_locals))
        except Exception:
            return True     # A broken condition should stop, not vanish.

    def _should_step(self):
        if self.mode == STEP_IN:
            return True
        if self.mode == STEP_OVER:
            return self.depth <= self.step_depth
        if self.mode == STEP_OUT:
            return self.depth < self.step_depth
        return False

    def _is_user(self, filename):
        known = self.is_user_file.get(filename)
        if known is not None:
            return known

        path = _norm(filename)
        decided = path == self.script or any(
            path.startswith(root + os.sep) for root in self.roots
        )
        self.is_user_file[filename] = decided
        return decided

    def _suspend(self, frame, reason, text=None):
        self.mode = RUN
        self.pause_requested = False

        self.frames = {}
        self.frame_order = []
        self.variables = {}

        walked = frame
        frame_id = 1
        while walked is not None and self._is_user(walked.f_code.co_filename):
            self.frames[frame_id] = walked
            self.frame_order.append(frame_id)
            frame_id += 1
            walked = walked.f_back

        self.suspended = True
        self.resume.clear()
        self.send({
            'event': 'stopped',
            'reason': reason,
            'text': text,
            'line': frame.f_lineno,
            'file': frame.f_code.co_filename
        })

        while not self.resume.is_set() and self.alive:
            self.resume.wait(0.2)

        self.suspended = False
        self.send({'event': 'continued'})


class _LocalTracer(object):
    """
    Per-frame tracer. Holds the local tracer SikuliX's abort function returned
    for this frame so both keep receiving events.
    """

    def __init__(self, agent, chained):
        self.agent = agent
        self.chained = chained

    def trace(self, frame, event, arg):
        if self.chained is not None:
            self.chained(frame, event, arg)
        if not self.agent.alive:
            return None
        try:
            self.agent._trace_user(frame, event, arg)
        except Exception:
            # A crash in the debugger must not take the script down with it.
            self.agent.send({'event': 'agentError', 'text': traceback.format_exc()})
            return None
        return self.trace


class _Scope(object):
    """A named mapping shown as a variable scope."""

    def __init__(self, names):
        self.names = names


def _norm(path):
    return os.path.normcase(os.path.abspath(path))


def _frame_name(frame):
    name = frame.f_code.co_name
    return os.path.basename(frame.f_code.co_filename) if name == '<module>' else name


def _repr(value):
    try:
        text = repr(value)
    except Exception:
        try:
            text = str(value)
        except Exception:
            return '<unrepresentable>'
    if len(text) > 400:
        text = text[:400] + '...'
    return text


def _type_name(value):
    try:
        return type(value).__name__
    except Exception:
        return ''


def _current_exception_text():
    kind, value = sys.exc_info()[:2]
    return ''.join(traceback.format_exception_only(kind, value)).strip()


def _exception_text(arg):
    try:
        return ''.join(traceback.format_exception_only(arg[0], arg[1])).strip()
    except Exception:
        return 'exception'
