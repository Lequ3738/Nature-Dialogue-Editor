import { EditorState } from "../editorTypes";

export interface MiniMapSize {
    w: number;
    h: number;
}

export interface MiniMapMeta {
    W: number;
    H: number;
    scale: number;
    offsetX: number;
    offsetY: number;
    bounds: {
        minX: number;
        minY: number;
        maxX: number;
        maxY: number;
    };
    viewRect: {
        left: number;
        top: number;
        width: number;
        height: number;
    };
}

export interface MiniMapResize {
    edge: "left" | "top";
    ox: number;
    oy: number;
    w: number;
    h: number;
}

export interface MiniMapViewStyle {
    width: string;
    height: string;
    left: string;
    top: string;
}

export function MiniMap({ 
    zoomPercent, minimapSize, minimapCanvasRef, minimapMeta, minimapResizeRef, 
    minimapViewStyle, setState
} : {
    zoomPercent: number,
    minimapSize: MiniMapSize,
    minimapCanvasRef: React.RefObject<HTMLCanvasElement | null>,
    minimapMeta: MiniMapMeta,
    minimapResizeRef: React.RefObject<MiniMapResize | null>,
    minimapViewStyle: MiniMapViewStyle,
    setState: (value: React.SetStateAction<EditorState>) => void,
}) {
    return (
        <div id="minimap" style={{ width: minimapSize.w, height: minimapSize.h }}>
            <canvas
                id="minimap-canvas"
                ref={minimapCanvasRef}
                style={{ pointerEvents: "auto" }}
                onMouseDown={(e) => {
                    const rect = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect();
                    const mx = e.clientX - rect.left;
                    const my = e.clientY - rect.top;
                    const worldX = (mx - minimapMeta.offsetX) / minimapMeta.scale;
                    const worldY = (my - minimapMeta.offsetY) / minimapMeta.scale;
                    setState((prev) => ({
                        ...prev,
                        view: {
                            ...prev.view,
                            x: -worldX * prev.view.zoom + window.innerWidth / 2,
                            y: -worldY * prev.view.zoom + window.innerHeight / 2,
                        },
                    }));
                }}
                onMouseMove={(e) => {
                    if (e.buttons !== 1) return;
                    e.preventDefault();
                    e.stopPropagation();
                    const rect = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect();
                    const mx = e.clientX - rect.left;
                    const my = e.clientY - rect.top;
                    const worldX = (mx - minimapMeta.offsetX) / minimapMeta.scale;
                    const worldY = (my - minimapMeta.offsetY) / minimapMeta.scale;
                    setState((prev) => ({
                        ...prev,
                        view: {
                            ...prev.view,
                            x: -worldX * prev.view.zoom + window.innerWidth / 2,
                            y: -worldY * prev.view.zoom + window.innerHeight / 2,
                        },
                    }));
                }}
            />
            <div
                className="minimap-resize minimap-resize-left"
                onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    minimapResizeRef.current = {
                        edge: "left",
                        ox: e.clientX,
                        oy: e.clientY,
                        w: minimapSize.w,
                        h: minimapSize.h,
                    };
                }}
            />
            <div
                className="minimap-resize minimap-resize-top"
                onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    minimapResizeRef.current = {
                        edge: "top",
                        ox: e.clientX,
                        oy: e.clientY,
                        w: minimapSize.w,
                        h: minimapSize.h,
                    };
                }}
            />
            <div id="minimap-zoom">缩放: {zoomPercent}%</div>
            <div id="minimap-view" style={minimapViewStyle} />
        </div>
    );
}