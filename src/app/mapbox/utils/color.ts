/** #rrggbb -> [r, g, b] (0-255). */
function hexToRgb(hex: string): [number, number, number] {
    const n = parseInt(hex.replace('#', ''), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function hslToHex(h: number, s: number, l: number): string {
    s /= 100;
    l /= 100;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs((h / 60) % 2 - 1));
    const m = l - c / 2;
    let [r, g, b] = [0, 0, 0];
    if(h < 60){ [r, g, b] = [c, x, 0]; }
    else if(h < 120){ [r, g, b] = [x, c, 0]; }
    else if(h < 180){ [r, g, b] = [0, c, x]; }
    else if(h < 240){ [r, g, b] = [0, x, c]; }
    else if(h < 300){ [r, g, b] = [x, 0, c]; }
    else { [r, g, b] = [c, 0, x]; }

    const toHex = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
    return `#${ toHex(r) }${ toHex(g) }${ toHex(b) }`;
}

function rgbToHsl([r, g, b]: [number, number, number]): [number, number, number] {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h = 0;
    let s = 0;
    const l = (max + min) / 2;

    if(max !== min){
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch(max){
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            default: h = (r - g) / d + 4; break;
        }
        h /= 6;
    }

    return [h * 360, s * 100, l * 100];
}

/** Luminancia relativa (WCAG 2.x) de un color #rrggbb. */
function relativeLuminance(hex: string): number {
    const [r, g, b] = hexToRgb(hex).map(channel => {
        const s = channel / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Ratio de contraste (WCAG 2.x) entre dos colores #rrggbb, siempre ≥ 1. */
export function contrastRatio(hexA: string, hexB: string): number {
    const lA = relativeLuminance(hexA);
    const lB = relativeLuminance(hexB);
    const [lighter, darker] = lA > lB ? [lA, lB] : [lB, lA];
    return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Aclara `hex` en el espacio HSL (mismo tono, más luminosidad) hasta que su
 * contraste contra `backgroundHex` alcanza `minRatio`, sin sobrepasar una
 * luminosidad de 95 (evita llegar a blanco puro). Se usa para derivar, a
 * partir de un color de marca que puede ser demasiado oscuro/saturado sobre
 * el fondo oscuro de la app, una variante apta para texto/iconos sin perder
 * el tono que identifica a la marca.
 */
export function ensureContrast(hex: string, backgroundHex: string, minRatio = 4.5): string {
    if(contrastRatio(hex, backgroundHex) >= minRatio){
        return hex;
    }

    const [h, s] = rgbToHsl(hexToRgb(hex));
    let l = rgbToHsl(hexToRgb(hex))[2];
    let candidate = hex;

    for(let guard = 0; guard < 40 && l < 95; guard++){
        l += 2;
        candidate = hslToHex(h, s, l);
        if(contrastRatio(candidate, backgroundHex) >= minRatio){
            break;
        }
    }

    return candidate;
}
