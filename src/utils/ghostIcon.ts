/**
 * Utility to generate a dynamic "Ghost Icon" for drag and drop operations.
 * Uses the Canvas API to create a translucent preview card.
 */

export interface GhostIconOptions {
    name: string;
    isDir: boolean;
    count: number;
    // We can pass the actual element to clone its look exactly
    element?: HTMLElement | null;
    // Optional: explicit Base64 thumbnail data (bypasses DOM traversal)
    thumbnailBase64?: string;
}

/**
 * Creates a translucent ghost icon and returns it as a Base64 PNG string.
 */
export async function createGhostIcon(options: GhostIconOptions): Promise<string> {
    const { name, isDir, count, element, thumbnailBase64 } = options;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';

    // Set canvas size (128x128 for good visibility)
    canvas.width = 128;
    canvas.height = 128;

    const centerX = 64;
    const centerY = 64;
    const radius = 16;
    const size = 110;
    const startX = centerX - size / 2;
    const startY = centerY - size / 2;

    // 1. Draw the "Glass Card" background
    ctx.beginPath();
    ctx.moveTo(startX + radius, startY);
    ctx.arcTo(startX + size, startY, startX + size, startY + size, radius);
    ctx.arcTo(startX + size, startY + size, startX, startY + size, radius);
    ctx.arcTo(startX, startY + size, startX, startY, radius);
    ctx.arcTo(startX, startY, startX + size, startY, radius);
    ctx.closePath();

    ctx.fillStyle = 'rgba(15, 17, 26, 0.7)'; // Dark translucent base
    ctx.fill();

    // Subtle border
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // 2. Draw the Icon or Thumbnail from the provided element
    let sourceImg: CanvasImageSource | null = null;

    if (thumbnailBase64) {
        // Explicit Base64 thumbnail takes priority (e.g. JIT fetch from backend)
        sourceImg = await new Promise<HTMLImageElement | null>((resolve) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => resolve(null);
            img.src = thumbnailBase64;
        });
    } else if (element) {
        // Find <img> or <svg> inside the element
        const img = element.querySelector('img');
        const svg = element.querySelector('svg');

        if (img && img.complete && img.naturalWidth > 0) {
            sourceImg = img;
        } else if (svg) {
            sourceImg = await svgToImage(svg);
        }
    }

    if (sourceImg) {
        const drawSize = 70;
        let w = drawSize;
        let h = drawSize;

        // Maintain aspect ratio if it's an image
        if (sourceImg instanceof HTMLImageElement) {
            const aspect = sourceImg.naturalWidth / sourceImg.naturalHeight;
            if (aspect > 1) h = drawSize / aspect;
            else w = drawSize * aspect;
        }

        ctx.drawImage(sourceImg, centerX - w / 2, centerY - h / 2 - 5, w, h);
    } else {
        drawFallbackIcon(ctx, centerX, centerY, isDir);
    }

    // 3. Draw File/Folder Name
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.font = 'bold 11px "Inter", system-ui, sans-serif';
    ctx.textAlign = 'center';
    const displayName = name.length > 18 ? name.substring(0, 15) + '...' : name;
    ctx.fillText(displayName, centerX, centerY + 45);

    // 4. Draw Multiple Items Badge (+N)
    if (count > 1) {
        const badgeRadius = 11;
        const badgeX = startX + size - 8;
        const badgeY = startY + 8;

        ctx.beginPath();
        ctx.arc(badgeX, badgeY, badgeRadius, 0, Math.PI * 2);
        ctx.fillStyle = '#3b82f6';
        ctx.fill();
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        ctx.fillStyle = 'white';
        ctx.font = 'bold 10px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`+${count - 1}`, badgeX, badgeY);
    }

    return canvas.toDataURL('image/png');
}

/**
 * Converts an SVG element to a CanvasImageSource (HTMLImageElement)
 */
async function svgToImage(svg: SVGSVGElement): Promise<HTMLImageElement | null> {
    try {
        const clonedSvg = svg.cloneNode(true) as SVGSVGElement;

        // Ensure it has dimensions and namespace
        if (!clonedSvg.getAttribute('xmlns')) {
            clonedSvg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        }

        // Use computed colors if possible, or force white for visibility on dark ghost card
        clonedSvg.style.color = 'white';
        const paths = clonedSvg.querySelectorAll('path');
        paths.forEach(p => {
            if (p.getAttribute('stroke') && p.getAttribute('stroke') !== 'none') {
                p.setAttribute('stroke', 'white');
            }
        });

        const svgData = new XMLSerializer().serializeToString(clonedSvg);
        const svgBase64 = btoa(unescape(encodeURIComponent(svgData)));
        const img = new Image();

        return new Promise((resolve) => {
            img.onload = () => resolve(img);
            img.onerror = () => resolve(null);
            img.src = `data:image/svg+xml;base64,${svgBase64}`;
        });
    } catch (e) {
        return null;
    }
}

function drawFallbackIcon(ctx: CanvasRenderingContext2D, x: number, y: number, isDir: boolean) {
    if (isDir) {
        ctx.fillStyle = '#3b82f6';
        ctx.beginPath();
        ctx.moveTo(x - 20, y - 25);
        ctx.lineTo(x - 5, y - 25);
        ctx.lineTo(x, y - 20);
        ctx.lineTo(x + 20, y - 20);
        ctx.lineTo(x + 20, y + 15);
        ctx.lineTo(x - 20, y + 15);
        ctx.closePath();
        ctx.fill();
    } else {
        ctx.fillStyle = '#94a3b8';
        ctx.beginPath();
        ctx.moveTo(x - 15, y - 25);
        ctx.lineTo(x + 5, y - 25);
        ctx.lineTo(x + 15, y - 15);
        ctx.lineTo(x + 15, y + 20);
        ctx.lineTo(x - 15, y + 20);
        ctx.closePath();
        ctx.fill();
    }
}

