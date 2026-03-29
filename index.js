// --- 状态与初始化 ---
let state = {
    nodes: [],
    edges: [], // {fromId, toId, type: 'default'|'true'|'false'}
    comments: [],
    idCounter: 1,
    view: { x: 500, y: 500, zoom: 1 },
    isPanning: false,
    dragTarget: null,
    connecting: null // {fromId, type}
};

const viewport = document.getElementById('viewport');
const content = document.getElementById('content-layer');
const canvas = document.getElementById('line-canvas');
const ctx = canvas.getContext('2d');
const minimapCanvas = document.getElementById('minimap-canvas');

function init() {
    window.addEventListener('resize', resize);
    viewport.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    viewport.addEventListener('wheel', onWheel, {passive: false});
    minimapCanvas.addEventListener('mousedown', jumpMinimap);
    
    resize();
    requestAnimationFrame(frame);
}

function resize() {
    canvas.width = 10000;
    canvas.height = 10000;
    render();
}

function frame() {
    drawMinimap();
    requestAnimationFrame(frame);
}

// --- 视图控制 ---
function updateTransform() {
    content.style.transform = `translate(${state.view.x}px, ${state.view.y}px) scale(${state.view.zoom})`;
    const mv = document.getElementById('minimap-view');
    mv.style.width = (window.innerWidth / state.view.zoom / 50) + 'px';
    mv.style.height = (window.innerHeight / state.view.zoom / 50) + 'px';
    mv.style.left = (-state.view.x / state.view.zoom / 50) + 'px';
    mv.style.top = (-state.view.y / state.view.zoom / 50) + 'px';
}

function onMouseDown(e) {
    if (e.button === 1) { // 中键平移
        state.isPanning = true;
        state.lastMouse = { x: e.clientX, y: e.clientY };
        e.preventDefault();
    }
}

function onMouseMove(e) {
    if (state.isPanning) {
        state.view.x += e.clientX - state.lastMouse.x;
        state.view.y += e.clientY - state.lastMouse.y;
        state.lastMouse = { x: e.clientX, y: e.clientY };
        updateTransform();
    }
    if (state.dragTarget) {
        const dx = (e.clientX - state.dragTarget.ox) / state.view.zoom;
        const dy = (e.clientY - state.dragTarget.oy) / state.view.zoom;
        const obj = state.dragTarget.ref;
        obj.x += dx; obj.y += dy;
        state.dragTarget.ox = e.clientX;
        state.dragTarget.oy = e.clientY;
        render();
    }
}

function onMouseUp() {
    state.isPanning = false;
    state.dragTarget = null;
}

function onWheel(e) {
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const nextZoom = Math.min(Math.max(0.1, state.view.zoom * delta), 2);
    
    // 以鼠标为中心缩放
    const mouseX = (e.clientX - state.view.x) / state.view.zoom;
    const mouseY = (e.clientY - state.view.y) / state.view.zoom;
    
    state.view.zoom = nextZoom;
    state.view.x = e.clientX - mouseX * state.view.zoom;
    state.view.y = e.clientY - mouseY * state.view.zoom;
    
    updateTransform();
    e.preventDefault();
}

// --- 逻辑操作 ---
function addObject(type) {
    const center = {
        x: (window.innerWidth/2 - state.view.x) / state.view.zoom,
        y: (window.innerHeight/2 - state.view.y) / state.view.zoom
    };
    if (type === 'comment') {
        state.comments.push({ id: 'c'+(state.idCounter++), x: center.x, y: center.y, w: 400, h: 300, text: '区域注释' });
    } else {
        state.nodes.push({
            id: state.idCounter++,
            type: type, // node | condition
            x: center.x, y: center.y,
            cn: type === 'condition' ? '变量 > 0?' : '对话内容...',
            en: '', code: '', color: type === 'condition' ? '#e67e22' : '#7289da'
        });
    }
    render();
}

function startConnect(id, type, e) {
    e.stopPropagation();
    if (!state.connecting) {
        state.connecting = { fromId: id, type };
    } else {
        if (state.connecting.fromId !== id) {
            // 移除旧连线（确保单出口逻辑）
            state.edges = state.edges.filter(edge => !(edge.fromId === state.connecting.fromId && edge.type === state.connecting.type));
            state.edges.push({ fromId: state.connecting.fromId, toId: id, type: state.connecting.type });
        }
        state.connecting = null;
    }
    render();
}

function render() {
    const container = document.getElementById('objects-container');
    container.innerHTML = '';

    // 渲染注释框
    state.comments.forEach(c => {
        const el = document.createElement('div');
        el.className = 'comment-box';
        el.style.cssText = `left:${c.x}px; top:${c.y}px; width:${c.w}px; height:${c.h}px;`;
        el.innerHTML = `
            <div class="comment-handle" onmousedown="beginDrag(event, 'comment', '${c.id}')">${c.text}</div>
            <div class="comment-resizer" onmousedown="beginResize(event, '${c.id}')"></div>
        `;
        container.appendChild(el);
    });

    // 渲染节点
    state.nodes.forEach(n => {
        const el = document.createElement('div');
        el.className = 'node';
        el.style.cssText = `left:${n.x}px; top:${n.y}px; border-color:${n.color};`;
        
        const isCond = n.type === 'condition';
        el.innerHTML = `
            <div class="node-header" onmousedown="beginDrag(event, 'node', ${n.id})">
                <span>${isCond ? 'CONDITION' : 'DIALOGUE'} #${n.id}</span>
                <span onclick="openModal(${n.id})" style="cursor:pointer">⚙️</span>
            </div>
            <div class="node-body">${n.cn}${n.en ? '\n<hr style="opacity:0.2">'+n.en : ''}</div>
            <div class="node-footer">
                ${isCond ? `
                    <button class="port ${hasEdge(n.id, 'true')?'connected':''}" onclick="startConnect(${n.id}, 'true', event)">TRUE</button>
                    <button class="port ${hasEdge(n.id, 'false')?'connected':''}" onclick="startConnect(${n.id}, 'false', event)">FALSE</button>
                ` : `
                    <button class="port ${hasEdge(n.id, 'default')?'connected':''}" onclick="startConnect(${n.id}, 'default', event)">NEXT →</button>
                `}
            </div>
        `;
        if (state.connecting?.fromId === n.id) el.style.boxShadow = "0 0 20px #f1c40f";
        container.appendChild(el);
    });

    drawEdges();
    updateTransform();
}

function hasEdge(fromId, type) {
    return state.edges.some(e => e.fromId === fromId && e.type === type);
}

function drawEdges() {
    ctx.clearRect(0,0,10000,10000);
    state.edges.forEach(edge => {
        const from = state.nodes.find(n => n.id === edge.fromId);
        const to = state.nodes.find(n => n.id === edge.toId);
        if (!from || !to) return;

        const startX = from.x + 130;
        const startY = from.y + 100;
        const endX = to.x + 130;
        const endY = to.y;

        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.bezierCurveTo(startX, startY + 60, endX, endY - 60, endX, endY);
        
        if (edge.type === 'true') ctx.strokeStyle = '#43b581';
        else if (edge.type === 'false') ctx.strokeStyle = '#f04747';
        else ctx.strokeStyle = '#7289da';
        
        ctx.lineWidth = 3;
        ctx.stroke();
        
        // 箭头
        ctx.fillStyle = ctx.strokeStyle;
        ctx.beginPath();
        ctx.arc(endX, endY, 5, 0, Math.PI*2);
        ctx.fill();
    });
}

// --- 拖拽与缩略图逻辑 ---
function beginDrag(e, type, id) {
    e.stopPropagation();
    const ref = type === 'node' ? state.nodes.find(n => n.id === id) : state.comments.find(c => c.id === id);
    state.dragTarget = { ref, ox: e.clientX, oy: e.clientY };
}

function beginResize(e, id) {
    e.stopPropagation();
    const c = state.comments.find(x => x.id === id);
    const ox = e.clientX, oy = e.clientY, sw = c.w, sh = c.h;
    const move = (me) => {
        c.w = sw + (me.clientX - ox) / state.view.zoom;
        c.h = sh + (me.clientY - oy) / state.view.zoom;
        render();
    };
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
}

function drawMinimap() {
    const mCtx = minimapCanvas.getContext('2d');
    mCtx.clearRect(0,0,180,130);
    mCtx.fillStyle = "#555";
    state.nodes.forEach(n => mCtx.fillRect(n.x/50, n.y/50, 5, 4));
    mCtx.strokeStyle = "#333";
    state.comments.forEach(c => mCtx.strokeRect(c.x/50, c.y/50, c.w/50, c.h/50));
}

function jumpMinimap(e) {
    const rect = minimapCanvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * 50;
    const my = (e.clientY - rect.top) * 50;
    state.view.x = -mx * state.view.zoom + window.innerWidth/2;
    state.view.y = -my * state.view.zoom + window.innerHeight/2;
    updateTransform();
}

// --- 导出与导入 (工程合一) ---
function exportProject() {
    let gml = `// GM8 对话系统导出 (有向图结构)\n// 使用编辑器重新加载此文件可编辑布局\n\nvar _g, _n;\n_g = ds_graph_create();\n\n`;
    
    // 节点导出
    state.nodes.forEach(n => {
        gml += `// Node #${n.id}\n_n[${n.id}] = ds_graph_node_add(_g, '\n`;
        gml += `    var _text; \n`;
        gml += `    _text[lang_cn] = "${n.cn.replace(/"/g, '""').replace(/\n/g, '#')}";\n`;
        gml += `    _text[lang_en] = "${n.en.replace(/"/g, '""').replace(/\n/g, '#')}";\n`;
        gml += `    displayingText = _text[global.language];\n`;
        if (n.code) gml += `    ${n.code.replace(/\n/g, '\n    ')}\n`;
        gml += `');\n\n`;
    });

    // 边与作用域导出 (修正条件逻辑)
    gml += `// 逻辑分支定义\n`;
    state.nodes.forEach(n => {
        if (n.type === 'condition') {
            const t = state.edges.find(e => e.fromId === n.id && e.type === 'true');
            const f = state.edges.find(e => e.fromId === n.id && e.type === 'false');
            gml += `// Condition Scope #${n.id}\n`;
            gml += `if (${n.code || 'true'}) {\n`;
            if(t) gml += `    ds_graph_edge_add(_g, _n[${n.id}], _n[${t.toId}], 1, true);\n`;
            gml += `} else {\n`;
            if(f) gml += `    ds_graph_edge_add(_g, _n[${n.id}], _n[${f.toId}], 0, true);\n`;
            gml += `}\n\n`;
        } else {
            const e = state.edges.find(edge => edge.fromId === n.id);
            if(e) gml += `ds_graph_edge_add(_g, _n[${n.id}], _n[${e.toId}], 0, true);\n`;
        }
    });

    gml += `return _g;\n\n`;

    // 写入元数据 (工程文件恢复)
    const meta = btoa(encodeURIComponent(JSON.stringify(state)));
    gml += `/* EDITOR_DATA:${meta} */`;

    const blob = new Blob([gml], {type: "text/plain"});
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "dialog_system.gml";
    a.click();
}

function importProject(input) {
    const reader = new FileReader();
    reader.onload = (e) => {
        const content = e.target.result;
        const match = content.match(/\/\* EDITOR_DATA:(.*) \*\//);
        if (match) {
            state = JSON.parse(decodeURIComponent(atob(match[1])));
            render();
        } else { alert("此文件不含编辑器元数据！"); }
    };
    reader.readAsText(input.files[0]);
}

// --- 属性弹窗 ---
let editingId = null;
function openModal(id) {
    editingId = id;
    const n = state.nodes.find(x => x.id === id);
    document.getElementById('m-cn').value = n.cn;
    document.getElementById('m-en').value = n.en;
    document.getElementById('m-code').value = n.code;
    document.getElementById('m-color').value = n.color;
    document.getElementById('modal-overlay').style.display = 'flex';
}
function closeModal() { document.getElementById('modal-overlay').style.display = 'none'; }
function saveModal() {
    const n = state.nodes.find(x => x.id === editingId);
    n.cn = document.getElementById('m-cn').value;
    n.en = document.getElementById('m-en').value;
    n.code = document.getElementById('m-code').value;
    n.color = document.getElementById('m-color').value;
    closeModal(); render();
}
function deleteCurrent() {
    state.nodes = state.nodes.filter(n => n.id !== editingId);
    state.edges = state.edges.filter(e => e.fromId !== editingId && e.toId !== editingId);
    closeModal(); render();
}

init();