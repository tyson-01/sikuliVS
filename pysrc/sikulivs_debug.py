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
import time
import json
import shutil
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

# Stops worth a screenshot. A step is deliberately absent: stepping a loop would
# fill the filmstrip with near-identical frames and put a capture on the critical
# path of every keystroke.
CAPTURE_REASONS = (BREAKPOINT, EXCEPTION, PAUSE, ENTRY)

THUMBNAIL_WIDTH = 240

# Capture modes, set by the adapter.
CAPTURE_OFF = 'off'
CAPTURE_STOPS = 'stops'
CAPTURE_ACTIONS = 'actions'

# A line that took at least this long did something: a find, a click, a wait.
# Assignments and arithmetic return in microseconds, so this separates the lines
# worth photographing from the ones that only move numbers around.
ACTION_SECONDS = 0.12

# Similarity used when re-running a failed search. Low enough that anything
# recognisable comes back with a score to compare against what was asked for.
DIAGNOSE_SIMILARITY = 0.05


class AgentError(Exception):
    """A failure worth reporting as a plain message rather than a traceback."""

# Stepping modes.
RUN = 0
STEP_IN = 1
STEP_OVER = 2
STEP_OUT = 3


def launch(port, script, bundle, roots, stop_on_entry, capture_dir, script_globals):
    """
    Runs `script` under the debugger. Returns the exit code the runner should
    report; raises whatever the script raised so SikuliX still reports it.
    """
    agent = _Agent(port, script, roots, capture_dir)
    agent.connect()
    try:
        agent.run(script, bundle, stop_on_entry, script_globals)
    finally:
        agent.close()


class _Agent(object):
    def __init__(self, port, script, roots, capture_dir):
        self.port = port
        self.script = _norm(script)
        self.roots = [_norm(root) for root in roots]
        self.capture_dir = capture_dir
        self.capture_mode = CAPTURE_STOPS
        self.frame_count = 0
        self.last_line = None

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
        self.stop_on_uncaught = True
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
        existing = self.breakpoints.get(path, {})
        lines = {}

        for entry in request.get('breakpoints', []):
            line = int(entry['line'])
            previous = existing.get(line)
            lines[line] = {
                'condition': entry.get('condition') or None,
                'hitCondition': entry.get('hitCondition') or None,
                # Keep the count across an edit, so re-saving a file mid-run
                # does not restart a hit condition that was part way there.
                'hits': previous['hits'] if previous else 0
            }

        self.breakpoints[path] = lines
        return {'lines': sorted(lines.keys())}

    def _cmd_setExceptionBreakpoints(self, request):
        self.stop_on_exception = bool(request.get('raised'))
        self.stop_on_uncaught = bool(request.get('uncaught', True))
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

    def _member_path(self, path, accessor):
        return (path + accessor) if path else ''

    def _script_names(self, namespace):
        return dict(
            (name, value) for name, value in namespace.items()
            if name not in self.preset_globals and not name.startswith('__')
        )

    def _cmd_variables(self, request):
        entry = self.variables.get(request['ref'])
        if entry is None:
            return {'variables': []}
        target, path = entry
        return {'variables': self._children(target, path)}

    def _cmd_evaluate(self, request):
        frame = self._current_frame(request.get('frameId'))
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

    def _cmd_setCaptureMode(self, request):
        self.capture_mode = request.get('mode') or CAPTURE_STOPS
        return {}

    def _cmd_capture(self, _request):
        """An on-demand frame, for the panel's capture button."""
        frame = self._capture_frame('manual')
        if frame is None:
            raise AgentError('The screen could not be captured.')
        return frame

    def _cmd_highlight(self, request):
        """Outlines a Region or Match variable on the real screen."""
        frame = self._current_frame(request.get('frameId'))
        target = eval(request['expression'], frame.f_globals, frame.f_locals)

        if not hasattr(target, 'highlight'):
            raise AgentError('%s cannot be highlighted.' % _type_name(target))

        seconds = float(request.get('seconds', 2))
        worker = threading.Thread(target=_highlight, args=(target, seconds))
        worker.setDaemon(True)
        worker.start()
        return {}

    def _cmd_diagnose(self, request):
        """
        Answers why a search failed, by re-running it at a threshold low enough
        that anything comparable scores.

        Two searches, because they answer different questions: inside the region
        the script actually looked at ("was it there at all, and how close?"),
        and across the whole screen ("is it somewhere else entirely?"). The
        second is the common answer, and reporting only that one is misleading -
        it says 1.00 for an image the script could never have seen.

        Coordinates are relative to the screenshot throughout.
        """
        image = request['image']
        screenshot = request['screenshot']
        region = request.get('region')

        # Let SikuliX resolve the name, exactly as the failed search did, so a
        # bare "button.png" finds the same file through the bundle path.
        resolved = self._resolve_image(image)

        result = {
            'imagePath': resolved,
            'imageFound': bool(resolved) and os.path.exists(resolved),
            'overall': self._best_match(screenshot, image),
            'inRegion': None,
            'minSimilarity': self._min_similarity()
        }

        if region:
            cropped = self._crop(screenshot, region)
            if cropped:
                path, origin = cropped
                try:
                    found = self._best_match(path, image)
                finally:
                    try:
                        os.remove(path)
                    except OSError:
                        pass
                if found:
                    # Back into screenshot coordinates, so the panel can draw it.
                    found['rect']['x'] += origin[0]
                    found['rect']['y'] += origin[1]
                result['inRegion'] = found

        return result

    def _resolve_image(self, name):
        try:
            return self.script_globals['Pattern'](name).getFilename()
        except Exception:
            return name

    def _best_match(self, haystack, needle):
        """The closest thing to `needle` in `haystack`, however poor."""
        finder = self.script_globals['Finder'](haystack)
        pattern = self.script_globals['Pattern'](needle)

        try:
            finder.find(pattern.similar(DIAGNOSE_SIMILARITY))
            if not finder.hasNext():
                return None

            match = finder.next()
            return {
                'score': match.getScore(),
                'rect': {
                    'x': match.getX(), 'y': match.getY(),
                    'w': match.getW(), 'h': match.getH()
                }
            }
        finally:
            try:
                finder.destroy()
            except Exception:
                pass

    def _crop(self, screenshot, region):
        """
        Writes the part of the screenshot the script was searching to its own
        file, so it can be searched in isolation. Returns the path and where the
        crop starts, or None if the region does not overlap the screenshot.
        """
        try:
            from java.io import File
            from javax.imageio import ImageIO

            full = ImageIO.read(File(screenshot))
            x = max(0, int(region['x']))
            y = max(0, int(region['y']))
            w = min(int(region['w']), full.getWidth() - x)
            h = min(int(region['h']), full.getHeight() - y)
            if w <= 0 or h <= 0:
                return None

            path = os.path.join(self.capture_dir or os.path.dirname(screenshot), '_search-area.png')
            ImageIO.write(full.getSubimage(x, y, w, h), 'png', File(path))
            return (path, (x, y))
        except Exception:
            return None

    def _min_similarity(self):
        """SikuliX's own default threshold, for when the script did not set one."""
        try:
            return self.script_globals['Settings'].MinSimilarity
        except Exception:
            return 0.7

    def _cmd_start(self, _request):
        self.started.set()
        return {}

    def _current_frame(self, frame_id):
        frame = self.frames.get(frame_id)
        if frame is None and self.frame_order:
            frame = self.frames.get(self.frame_order[0])
        if frame is None:
            raise AgentError('The script is not suspended.')
        return frame

    def _cmd_disconnect(self, _request):
        self.alive = False
        self.started.set()
        self._release()
        return {}

    def _release(self):
        self.pause_requested = False
        self.resume.set()

    # -- variables ---------------------------------------------------------

    def _handle(self, obj, path=''):
        handle = self.next_handle
        self.next_handle += 1
        self.variables[handle] = (obj, path)
        return handle

    def _describe(self, name, value, path=''):
        described = {
            'name': name,
            'value': _repr(value),
            'type': _type_name(value),
            'ref': 0,
            'path': path
        }
        if self._expandable(value):
            described['ref'] = self._handle(value, path)
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

    def _children(self, target, path=''):
        if isinstance(target, _Scope):
            pairs = sorted(target.names.items())
            return [self._describe(name, value, name)
                    for name, value in pairs[:MAX_CHILDREN]]

        if isinstance(target, dict):
            pairs = sorted(target.items(), key=lambda pair: _repr(pair[0]))
            return [self._describe(_repr(key), value,
                                   self._member_path(path, '[%s]' % _repr(key)))
                    for key, value in pairs[:MAX_CHILDREN]]

        if isinstance(target, (list, tuple)):
            return [self._describe('[%d]' % index, value,
                                   self._member_path(path, '[%d]' % index))
                    for index, value in enumerate(target[:MAX_CHILDREN])]

        if isinstance(target, (set, frozenset)):
            return [self._describe('{%d}' % index, value)
                    for index, value in enumerate(list(target)[:MAX_CHILDREN])]

        members = self._sikuli_members(target)
        if members is not None:
            return self._member_children(target, members, path)

        attributes = getattr(target, '__dict__', {})
        return [self._describe(name, value, self._member_path(path, '.' + name))
                for name, value in sorted(attributes.items())[:MAX_CHILDREN]]

    def _member_children(self, target, members, path=''):
        children = []
        for member in members:
            try:
                if member.endswith('()'):
                    value = getattr(target, member[:-2])()
                    name = member[:-2]
                    accessor = '.' + name + '()'
                else:
                    value = getattr(target, member)
                    name = member
                    accessor = '.' + name
            except Exception:
                continue    # Not on this SikuliX version, or not readable here.
            children.append(self._describe(name, value, self._member_path(path, accessor)))
        return children

    # -- capture -----------------------------------------------------------

    def _capture_frame(self, reason):
        """
        Writes a PNG of the screen plus a thumbnail, and describes where it came
        from so the panel can place overlays in screen coordinates.

        Never raises: a debugger that cannot take a screenshot is still a working
        debugger, and this runs on the path to every stop.
        """
        if not self.capture_dir:
            return None

        try:
            screen = self.script_globals['Screen']()
            image = screen.capture()

            self.frame_count += 1
            name = 'frame-%03d' % self.frame_count
            path = os.path.join(self.capture_dir, name + '.png')

            # Let SikuliX write into its own temp area and copy the bytes out,
            # rather than handing it the capture folder. A folder SikuliX has
            # written into does not reliably survive its shutdown, and these
            # frames have to outlive the run that produced them.
            written = image.getFile()
            shutil.copyfile(written, path)
            try:
                os.remove(written)
            except OSError:
                pass    # SikuliX cleans its own temp area anyway.

            thumbnail = os.path.join(self.capture_dir, name + '-thumb.png')
            if not _write_thumbnail(path, thumbnail):
                thumbnail = None

            return {
                'index': self.frame_count,
                'reason': reason,
                'path': path,
                'thumbnail': thumbnail,
                # Screen origin and size, so a Region's absolute coordinates can
                # be mapped onto pixels of this image.
                'bounds': {
                    'x': screen.getX(), 'y': screen.getY(),
                    'w': screen.getW(), 'h': screen.getH()
                }
            }
        except Exception:
            self.send({'event': 'agentError', 'text': traceback.format_exc()})
            return None

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
            # Stop before unwinding. Without this the most interesting moment in
            # a run, the failure, is the one moment that cannot be inspected,
            # because reporting it also ends the JVM that holds the answers.
            self._suspend_on_failure()

            # SikuliX blames the generated launcher for the failure, since that
            # is the file it was pointed at. Say where it really happened.
            self._report_failure()
            raise
        finally:
            sys.settrace(self.prev_trace)
            self.send({'event': 'exited'})

    def _suspend_on_failure(self):
        """
        Suspends on the deepest frame of the user's own code in the traceback.
        Those frames are still alive while the traceback holds them, so locals
        and the screen can both still be inspected.
        """
        if not self.stop_on_uncaught or not self.alive:
            return

        tb = sys.exc_info()[2]
        failing = None
        while tb is not None:
            if self._is_user(tb.tb_frame.f_code.co_filename):
                failing = tb.tb_frame
            tb = tb.tb_next

        if failing is not None:
            self._suspend(failing, EXCEPTION, _current_exception_text())

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

        if self.capture_mode == CAPTURE_ACTIONS:
            self._note_line(frame)

        if self.pause_requested:
            self._suspend(frame, PAUSE)
            return

        breakpoint = self._breakpoint_at(frame)
        if breakpoint is not None and self._breakpoint_fires(frame, breakpoint):
            self._suspend(frame, BREAKPOINT)
            return

        if self._should_step():
            reason = STEP
            if self.entry_pending:
                self.entry_pending = False
                reason = ENTRY
            self._suspend(frame, reason)

    def _note_line(self, frame):
        """
        Photographs the screen after any line that took long enough to have done
        something on it, which is what turns the filmstrip into a recording of
        the run rather than a record of where it happened to stop.
        """
        previous = self.last_line
        if previous is not None:
            elapsed = time.time() - previous[2]
            if elapsed >= ACTION_SECONDS:
                captured = self._capture_frame('action')
                if captured:
                    self.send({
                        'event': 'frame',
                        'capture': captured,
                        'file': previous[0],
                        'line': previous[1],
                        'elapsed': round(elapsed, 2)
                    })

        # Timed after any capture, so the cost of photographing one line is not
        # charged to the next one.
        self.last_line = (frame.f_code.co_filename, frame.f_lineno, time.time())

    def _breakpoint_at(self, frame):
        lines = self.breakpoints.get(_norm(frame.f_code.co_filename))
        if not lines:
            return None
        return lines.get(frame.f_lineno)

    def _breakpoint_fires(self, frame, breakpoint):
        """
        Whether this hit counts. A hit condition is measured against the number
        of times the condition itself held, not the times the line ran.
        """
        condition = breakpoint['condition']
        if condition and not self._condition_holds(frame, condition):
            return False

        breakpoint['hits'] += 1
        return _hit_condition_met(breakpoint['hitCondition'], breakpoint['hits'])

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

        # Capture before the stop is announced. The moment the editor is told,
        # it takes focus and paints itself over whatever the script was working
        # on, so a screenshot taken any later shows the editor instead.
        captured = None
        if self.capture_mode != CAPTURE_OFF and reason in CAPTURE_REASONS:
            captured = self._capture_frame(reason)

        self.suspended = True
        self.resume.clear()
        self.send({
            'event': 'stopped',
            'reason': reason,
            'text': text,
            'line': frame.f_lineno,
            'file': frame.f_code.co_filename,
            'capture': captured
        })

        while not self.resume.is_set() and self.alive:
            self.resume.wait(0.2)

        self.suspended = False
        # However long the stop lasted, it is not the next line's doing.
        self.last_line = None
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


def _write_thumbnail(source, destination):
    """
    Scales a captured frame down for the filmstrip, using the JDK's own imaging
    so nothing has to be added to the extension's dependencies.
    """
    try:
        from java.io import File
        from java.awt import RenderingHints
        from java.awt.image import BufferedImage
        from javax.imageio import ImageIO

        full = ImageIO.read(File(source))
        width = min(THUMBNAIL_WIDTH, full.getWidth())
        height = max(1, full.getHeight() * width // full.getWidth())

        thumbnail = BufferedImage(width, height, BufferedImage.TYPE_INT_RGB)
        graphics = thumbnail.createGraphics()
        graphics.setRenderingHint(RenderingHints.KEY_INTERPOLATION,
                                  RenderingHints.VALUE_INTERPOLATION_BILINEAR)
        graphics.drawImage(full, 0, 0, width, height, None)
        graphics.dispose()

        ImageIO.write(thumbnail, 'png', File(destination))
        return True
    except Exception:
        return False


def _highlight(target, seconds):
    try:
        target.highlight(seconds)
    except Exception:
        pass


def _hit_condition_met(expression, hits):
    """
    VS Code's hit conditions: a bare count, a comparison such as `>=5`, or `%3`
    for every third time. An unparseable one fires every time rather than never,
    so a typo cannot silently disable a breakpoint.
    """
    if not expression:
        return True

    text = expression.strip()
    try:
        for prefix, test in (
            ('>=', lambda n: hits >= n),
            ('<=', lambda n: hits <= n),
            ('==', lambda n: hits == n),
            ('>', lambda n: hits > n),
            ('<', lambda n: hits < n),
            ('%', lambda n: n > 0 and hits % n == 0),
        ):
            if text.startswith(prefix):
                return test(int(text[len(prefix):].strip()))
        return hits == int(text)
    except ValueError:
        return True


def _current_exception_text():
    kind, value = sys.exc_info()[:2]
    return ''.join(traceback.format_exception_only(kind, value)).strip()


def _exception_text(arg):
    try:
        return ''.join(traceback.format_exception_only(arg[0], arg[1])).strip()
    except Exception:
        return 'exception'
