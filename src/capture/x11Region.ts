import * as x11 from 'x11';

export type Region = {
    x: number;
    y: number;
    width: number;
    height: number;
};

export async function captureRegion(): Promise<Region> {

    return new Promise((resolve, reject) => {

        x11.createClient((err: any, display: any) => {
            if (err) return reject(err);

            const X = display.client;
            const root = display.screen[0].root;

            let startX = 0;
            let startY = 0;
            let endX = 0;
            let endY = 0;

            let dragging = false;

            const win = X.AllocID();

            const screen = display.screen[0];
            const width = screen.pixel_width;
            const height = screen.pixel_height;

            let cleaned = false;
            const cleanup = () => {
                if (cleaned) return;
                cleaned = true;
                X.DestroyWindow(win);
            };

            X.on('error', (err: any) => {
                console.error('sikuliVS: X11 protocol error', err);
                cleanup();
                reject(err);
            });

            X.CreateWindow(
                win,
                root,
                0, 0, width, height,
                0,
                0,
                0,
                0,
                {
                    eventMask:
                        x11.eventMask.PointerMotion |
                        x11.eventMask.ButtonPress |
                        x11.eventMask.ButtonRelease |
                        x11.eventMask.KeyPress,
                    overrideRedirect: 1
                }
            );

            X.MapWindow(win);

            // focus=win, revert_to=RevertToParent(2), time=CurrentTime(0)
            X.SetInputFocus(win, 2, 0);

            X.on('event', (ev: any) => {

                if (ev.type === 4) { // ButtonPress
                    dragging = true;
                    startX = ev.rootx;
                    startY = ev.rooty;
                }

                if (ev.type === 6 && dragging) { // MotionNotify
                    endX = ev.rootx;
                    endY = ev.rooty;
                }

                if (ev.type === 5 && dragging) { // ButtonRelease
                    dragging = false;

                    cleanup();

                    const x = Math.min(startX, endX);
                    const y = Math.min(startY, endY);
                    const width = Math.abs(endX - startX);
                    const height = Math.abs(endY - startY);

                    resolve({ x, y, width, height });
                }

                if (ev.type === 2) { // KeyPress
                    if (ev.keycode === 9) { // ESC
                        cleanup();
                        reject('Region capture cancelled');
                    }
                }
            });
        });
    });
}