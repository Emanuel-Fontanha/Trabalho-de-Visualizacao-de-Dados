const initialFilters = {
    cities: null, // string[] | null  -> dimensão "where" (cidades selecionadas; null/[] = todas as 10)
    priceRange: null, // [min, max] em USD (ver price_usd em data.js)  -> dimensão "what"
    bbox: null, // {city, bbox:{lonMin, lonMax, latMin, latMax}} -> dimensão "where" (região dentro de 1 cidade)
    dateRange: null, // [isoStart, isoEnd] -> dimensão "when"
    ratingRange: null, // [min, max] -> dimensão "how" (avaliação média do imóvel)
};

const state = {
    filters: { ...initialFilters },
    selection: null, // listing_id selecionado no mapa (details on demand)
};

const listeners = new Set();

// Avisa todos os inscritos. Centralizado aqui para garantir que toda
// alteração de estado (de onde quer que venha) dispare a mesma notificação.
function notify() {
    listeners.forEach((fn) => fn(state));
}

export function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

export function setState(patch) {
    Object.assign(state, patch);
    notify();
}

// Faz merge raso em filters (preserva os outros filtros já ativos) — assim
// cada view só precisa informar o filtro que ela mesma controla, sem se
// preocupar em repetir os filtros das outras.
export function updateFilters(patch) {
    state.filters = { ...state.filters, ...patch };
    notify();
}

export function clearFilters() {
    state.filters = { ...initialFilters };
    state.selection = null;
    notify();
}

export function setSelection(id) {
    state.selection = id;
    notify();
}

export function getState() {
    return state;
}