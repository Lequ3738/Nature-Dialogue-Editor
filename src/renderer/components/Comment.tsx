import { hexToRgba } from "../utils/color";
import { CommentBox, DragTarget } from "../editorTypes";

export function CommentNode({
    theme, c, openCommentModal, beginDrag, beginTouchDrag, beginResize, 
    beginTouchResize,
} : {
    theme: "dark" | "light";
    c: CommentBox;
    openCommentModal: (id: string) => void;
    beginDrag: (e: React.MouseEvent<Element, MouseEvent>, target: DragTarget) => void;
    beginTouchDrag: (e: React.TouchEvent<Element>, target: DragTarget) => void;
    beginResize: (e: React.MouseEvent<Element, MouseEvent>, commentId: string) => void;
    beginTouchResize: (e: React.TouchEvent<Element>, commentId: string) => void;
})
{
    return (
        <div
            key={c.id}
            className="comment-box"
            style={{
                left: c.x,
                top: c.y,
                width: c.w,
                height: c.h,
                borderColor: c.color,
                background: hexToRgba(c.color, theme === "light" ? 0.08 : 0.06),
            }}
        >
            <div
                style={{
                    position: "absolute",
                    inset: 0,
                    zIndex: 0,
                    pointerEvents: "auto",
                }}
                title={c.text || undefined}
            />
            <div
                className="comment-handle"
                style={{
                    background: c.color,
                    borderColor: c.color,
                    color: "#fff",
                }}
                onDoubleClick={(e) => {
                    e.stopPropagation();
                    openCommentModal(c.id);
                }}
                onMouseDown={(e) =>
                    beginDrag(e, {
                        kind: "comment",
                        id: c.id,
                        ox: e.clientX,
                        oy: e.clientY,
                    })
                }
                onTouchStart={(e) =>
                    beginTouchDrag(e, {
                        kind: "comment",
                        id: c.id,
                        ox: e.touches[0].clientX,
                        oy: e.touches[0].clientY,
                    })
                }
            >
                {c.text}
            </div>
            <div
                className="comment-resizer"
                onMouseDown={(e) => beginResize(e, c.id)}
                onTouchStart={(e) => beginTouchResize(e, c.id)}
            />
        </div>
    );
}