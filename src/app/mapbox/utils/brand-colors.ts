import { contrastRatio, ensureContrast } from './color';

/** Fondo real de la tarjeta de estación (--color-bg-surface en styles.css), usado como referencia de contraste. */
const POPUP_BACKGROUND = '#17212f';

/** Color por marca para los puntos del mapa y el chip del popup. */
export const BRAND_COLORS: Record<string, string> = {
    REPSOL: '#03a9f4',
    CAMPSA: '#e53935',
    PETRONOR: '#1e88e5',
    CEPSA: '#fb8c00',
    SHELL: '#fdd835',
    GALP: '#8e24aa',
    BP: '#43a047'
};

/** Color por defecto para marcas fuera de BRAND_COLORS (mismo gris que ya usaba el mapa). */
export const DEFAULT_BRAND_COLOR = '#9e9e9e';

/** Color de marca (o el color por defecto) para una estación, dado su campo "Estacion". */
export function getBrandColor(estacion?: string): string {
    return (estacion && BRAND_COLORS[estacion]) || DEFAULT_BRAND_COLOR;
}

/**
 * Variante de getBrandColor() apta para texto/iconos sobre el fondo oscuro
 * de la tarjeta (contraste ≥ 4.5:1, AA para texto normal): algunos colores
 * de marca (p.ej. el morado de GALP) no llegan a ese contraste tal cual.
 * Precalculado una sola vez al cargar el módulo, no en cada popup.
 */
const BRAND_TEXT_COLORS: Record<string, string> = Object.fromEntries(
    Object.entries(BRAND_COLORS).map(([brand, color]) => [brand, ensureContrast(color, POPUP_BACKGROUND)])
);
const DEFAULT_BRAND_TEXT_COLOR = ensureContrast(DEFAULT_BRAND_COLOR, POPUP_BACKGROUND);

export function getBrandTextColor(estacion?: string): string {
    return (estacion && BRAND_TEXT_COLORS[estacion]) || DEFAULT_BRAND_TEXT_COLOR;
}

/**
 * Texto legible (blanco o el fondo oscuro de la app) sobre un fondo relleno
 * con el color de marca "real" (getBrandColor), para el botón "Cómo llegar"
 * (relleno, no de contorno): con marcas claras como SHELL, el blanco no
 * tiene contraste suficiente y hace falta el oscuro en su lugar.
 */
const BRAND_FOREGROUND_ON_CHIP: Record<string, string> = Object.fromEntries(
    Object.entries(BRAND_COLORS).map(([brand, color]) => [
        brand,
        contrastRatio('#ffffff', color) >= contrastRatio(POPUP_BACKGROUND, color) ? '#ffffff' : POPUP_BACKGROUND
    ])
);
const DEFAULT_BRAND_FOREGROUND_ON_CHIP =
    contrastRatio('#ffffff', DEFAULT_BRAND_COLOR) >= contrastRatio(POPUP_BACKGROUND, DEFAULT_BRAND_COLOR)
        ? '#ffffff'
        : POPUP_BACKGROUND;

export function getBrandForegroundColor(estacion?: string): string {
    return (estacion && BRAND_FOREGROUND_ON_CHIP[estacion]) || DEFAULT_BRAND_FOREGROUND_ON_CHIP;
}

/** Expresión de estilo MapLibre ('match') equivalente a getBrandColor(), para pintar los puntos del mapa. */
export function buildBrandColorMatchExpression(): unknown[] {
    const expression: unknown[] = ['match', ['get', 'Estacion']];
    for(const [brand, color] of Object.entries(BRAND_COLORS)){
        expression.push(brand, color);
    }
    expression.push(DEFAULT_BRAND_COLOR);
    return expression;
}
