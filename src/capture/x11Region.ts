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

            X.CreateWindow(
                win,
                root,
                0, 0, 1920, 1080,
                0,
                0,
                0,
                0,
                { eventMask: x11.eventMask.PointerMotion | x11.eventMask.ButtonPress | x11.eventMask.ButtonRelease }
            );

            X.MapWindow(win);

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

                    X.DestroyWindow(win);

                    const x = Math.min(startX, endX);
                    const y = Math.min(startY, endY);
                    const width = Math.abs(endX - startX);
                    const height = Math.abs(endY - startY);

                    resolve({ x, y, width, height });
                }
            });
        });
    });
}