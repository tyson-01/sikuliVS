import asyncio
import io
import os
import subprocess
import tempfile
from PIL import Image
from dbus_fast import Message, MessageType
from dbus_fast.aio import MessageBus

def take_freeze_frame() -> Image.Image:
    """
    Captures a full-screen screenshot across diverse desktop environments.
    
    Attempts modern Freedesktop D-Bus Portal capturing first, falls back to 
    common CLI tools (Gnome, Wayland/Grim, KDE), and defaults to ImageGrab.
    """
    try:
        return asyncio.run(_async_capture_portal())
    except Exception:
        # Ultimate fallback for vanilla environments (uses Tkinter hooks under the hood)
        from PIL import ImageGrab
        return ImageGrab.grab()

async def _async_capture_portal() -> Image.Image:
    """Attempts Freedesktop DBus portal capture with quick local CLI fallbacks."""
    bus = await MessageBus().connect()
    
    msg = Message(
        destination='org.freedesktop.portal.Desktop',
        path='/org/freedesktop/portal/desktop',
        interface='org.freedesktop.portal.Screenshot',
        member='Screenshot',
        signature='sa{sv}',
        body=['', {'handle_token': ('s', 'sikulivs_token'), 'interactive': ('b', False)}]
    )
    
    reply = await bus.call(msg)
    
    if reply.message_type == MessageType.METHOD_RETURN:
        # DBus request succeeded; attempt local CLI utility capturing
        tmp_path = os.path.join(tempfile.gettempdir(), "svs_snap.png")
        
        fallback_commands = [
            ['gnome-screenshot', '-f', tmp_path],
            ['grim', tmp_path],
            ['spectacle', '-b', '-o', tmp_path]
        ]
        
        for cmd in fallback_commands:
            try:
                subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
                if os.path.exists(tmp_path):
                    img = Image.open(tmp_path).convert("RGB")
                    os.remove(tmp_path)
                    return img
            except (FileNotFoundError, subprocess.CalledProcessError):
                continue
                
    raise RuntimeError("Could not find a valid display capture driver on your desktop environment.")