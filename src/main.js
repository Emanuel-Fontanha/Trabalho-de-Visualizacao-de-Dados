import { DataLoader, PRICE_BINS } from './data.js';
import { subscribe, getState, updateFilters, setSelection, clearFilters } from './state.js';
import { createMap } from './views/map.js';
import { createTimeline } from './timeline.js';
import { createHistogram } from './histogram.js';
import { renderOverview, renderListing } from './details.js';

const loader = new DataLoader();

const detailsEl = document.querySelector('#details');
const statusEl = document.querySelector('#filter-status');
const loadingEl = document.querySelector('#loading');
const clearBtn = document.querySelector('#clear-filters');

// --- Views --------------------------------------------------------------
// Cada view só conhece seu próprio SVG e os callbacks que dispara — toda a
// coordenação entre elas passa pelo state.js (nenhuma view chama a outra
// diretamente).
const mapView = createMap('#map', {
    onSelect: (d) => setSelection(d.listing_id),
    onBrush: (bbox) => updateFilters({ bbox }),
});

const timelineView = createTimeline('#timeline-chart', {
    onBrush: (range) => updateFilters({ dateRange: range }),
});

const histogramView = createHistogram('#histogram-chart', {
    onBarClick: (binLabel) => {
        const bin = PRICE_BINS.find((b) => b.label === binLabel);
        if (!bin) return;
        const max = bin.max === Infinity ? 1e9 : bin.max;
        const current = getState().filters.priceRange;
        const isActive = current && current[0] === bin.min && current[1] === max;
        // clicar de novo na mesma barra remove o filtro (toggle)
        updateFilters({ priceRange: isActive ? null : [bin.min, max] });
    },
});

// Acha o bin ativo (se houver) a partir do filtro de preço corrente, só
// para destacar a barra correspondente no histograma.
function activeBinLabel(filters) {
    if (!filters.priceRange) return null;
    const [min, max] = filters.priceRange;
    const bin = PRICE_BINS.find((b) => b.min === min && (b.max === Infinity ? max === 1e9 : b.max === max));
    return bin ? bin.label : null;
}

function formatStatus(summary) {
    if (!statusEl) return;
    const n = summary?.n_listings ?? 0;
    statusEl.textContent = n === 1 ? '1 imóvel no filtro atual' : `${n} imóveis no filtro atual`;
}

// --- Re-renderização coordenada ------------------------------------------
// Toda vez que o estado muda (qualquer filtro ou seleção), refaz as 5
// consultas relevantes e atualiza as 4 views. Um contador de requisição
// evita que uma resposta antiga (de uma query lenta) sobrescreva uma mais
// recente caso o usuário mude o filtro rapidamente (race condition).
let requestId = 0;

async function renderAll(state) {
    const myRequest = ++requestId;
    const { filters, selection } = state;

    const [mapData, histData, timelineData, summary, neighbourhoods] = await Promise.all([
        loader.listingsForMap(filters),
        loader.priceHistogram(filters),
        loader.reviewsTimeSeries(filters),
        loader.summaryStats(filters),
        loader.topNeighbourhoods(filters, 5),
    ]);

    if (myRequest !== requestId) return; // uma requisição mais nova já chegou; descarta esta

    mapView.update(mapData, selection);
    timelineView.update(timelineData);
    histogramView.update(histData, activeBinLabel(filters));
    formatStatus(summary);

    if (selection) {
        const listing = await loader.listingDetails(selection);
        if (myRequest !== requestId) return;
        renderListing(detailsEl, listing, { onClose: () => setSelection(null) });
    } else {
        renderOverview(detailsEl, { summary, neighbourhoods });
    }
}

clearBtn?.addEventListener('click', () => {
    mapView.clearBrush();
    timelineView.clearBrush();
    clearFilters();
});

async function main() {
    subscribe(renderAll);

    await loader.init();
    await loader.loadAirbnb();

    if (loadingEl) loadingEl.style.display = 'none';

    await renderAll(getState());

    // Exposto para depuração no console (não usado pela UI).
    window.loader = loader;
}

window.addEventListener('DOMContentLoaded', () => {
    main().catch((err) => {
        console.error(err);
        if (loadingEl) loadingEl.textContent = 'Erro ao carregar os dados — veja o console.';
    });
});