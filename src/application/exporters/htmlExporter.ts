export function exportToHtmlBundle(svgDataUrl: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Ren'Py Web Flowchart Viewer - Export</title>
  <style>
    body { margin: 0; padding: 0; overflow: hidden; background: #1e293b; color: white; font-family: sans-serif; }
    #container { width: 100vw; height: 100vh; display: flex; align-items: center; justify-content: center; }
    img { max-width: none; max-height: none; cursor: grab; }
    img:active { cursor: grabbing; }
    #controls { position: absolute; bottom: 20px; right: 20px; display: flex; gap: 10px; }
    button { background: #4f46e5; color: white; border: none; padding: 8px 12px; border-radius: 4px; cursor: pointer; }
    button:hover { background: #4338ca; }
  </style>
</head>
<body>
  <div id="container">
    <img id="diagram" src="${svgDataUrl}" alt="Flowchart Diagram" />
  </div>
  <div id="controls">
    <button id="zoomIn">Zoom In</button>
    <button id="zoomOut">Zoom Out</button>
    <button id="reset">Reset</button>
  </div>
  <script>
    const container = document.getElementById('container');
    const diagram = document.getElementById('diagram');
    if (diagram) {
      let scale = 1;
      let translateX = 0;
      let translateY = 0;
      let isDragging = false;
      let startX, startY;

      function updateTransform() {
        diagram.style.transform = \`translate(\${translateX}px, \${translateY}px) scale(\${scale})\`;
      }

      document.getElementById('zoomIn').onclick = () => { scale *= 1.2; updateTransform(); };
      document.getElementById('zoomOut').onclick = () => { scale /= 1.2; updateTransform(); };
      document.getElementById('reset').onclick = () => { scale = 1; translateX = 0; translateY = 0; updateTransform(); };

      container.addEventListener('mousedown', (e) => {
        isDragging = true;
        startX = e.clientX - translateX;
        startY = e.clientY - translateY;
      });

      window.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        translateX = e.clientX - startX;
        translateY = e.clientY - startY;
        updateTransform();
      });

      window.addEventListener('mouseup', () => {
        isDragging = false;
      });
      
      container.addEventListener('wheel', (e) => {
        e.preventDefault();
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        scale *= delta;
        updateTransform();
      }, { passive: false });
    }
  </script>
</body>
</html>`;
}
