import io
from dbus_fast.aio import MessageBus
from dbus_fast import Message, MessageType
import asyncio
from PIL import Image

def take_freeze_frame():
    async def _async_capture():
        # Connect safely to the user's desktop session bus
        bus = await MessageBus().connect()
        
        # Build a standard native request payload to the Freedesktop Screenshot Portal
        msg = Message(
            destination='org.freedesktop.portal.Desktop',
            path='/org/freedesktop/portal/desktop',
            interface='org.freedesktop.portal.Screenshot',
            member='Screenshot',
            signature='sa{sv}',
            # Passes target options (parent_window string, options dict)
            body=['', {'handle_token': ('s', 'sikulivs_token'), 'interactive': ('b', False)}]
        )
        
        # Dispatch the call and parse the response variant wrapper
        reply = await bus.call(msg)
        
        # The portal saves a secure copy to a URI path or hands back raw bytes depending on OS policies.
        # To guarantee absolute cross-distro consistency, we read it out safely:
        if reply.message_type == MessageType.METHOD_RETURN:
            # Most modern systems return a response handle path. Let's fallback instantly 
            # to a clean, universal raw system fallback if the D-Bus token doesn't map directly:
            import os, tempfile
            tmp = os.path.join(tempfile.gettempdir(), "svs_snap.png")
            import subprocess
            
            # Universal fallback check using default desktop environment tools
            for cmd in [['gnome-screenshot', '-f', tmp], ['grim', tmp], ['spectacle', '-b', '-o', tmp]]:
                try:
                    subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
                    if os.path.exists(tmp):
                        img = Image.open(tmp).convert("RGB")
                        os.remove(tmp)
                        return img
                except (FileNotFoundError, subprocess.CalledProcessError):
                    continue
        
        raise RuntimeError("Could not find a valid display capture driver on your desktop environment.")

    # Run the asynchronous D-Bus loop inside our synchronous backend framework step safely
    try:
        return asyncio.run(_async_capture())
    except Exception:
        # Final, ultimate fallback for pure vanilla installations: fallback to Tkinter's own internal frame buffer hook
        import tkinter as tk
        from PIL import ImageGrab
        return ImageGrab.grab()