const EMPTY_NAME_TOKENS = new Set([
    '-',
    '--',
    'n/a',
    'na',
    'null',
    'undefined',
]);

export const sanitizeNamePart = (value: unknown): string => {
    if (typeof value !== 'string') return '';
    const trimmed = value.trim();
    if (!trimmed) return '';

    const normalized = trimmed.toLowerCase();
    if (EMPTY_NAME_TOKENS.has(normalized)) {
        return '';
    }

    return trimmed;
};

export const buildDisplayName = (
    firstName?: unknown,
    lastName?: unknown,
    fallback = 'User'
): string => {
    const safeFirst = sanitizeNamePart(firstName) || fallback;
    const safeLast = sanitizeNamePart(lastName);
    return `${safeFirst}${safeLast ? ` ${safeLast}` : ''}`.trim();
};
