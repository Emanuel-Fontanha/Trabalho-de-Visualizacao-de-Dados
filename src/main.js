import { DataLoader, PRICE_BINS } from './data.js';
import { subscribe, getState, updateFilters, setSelection, clearFilters } from './state.js';
import { createMap } from './views/map.js';
import { createTimeline } from './timeline.js';
import { createHistogram } from './histogram.js';
import { createDetailMap } from './detailMap.js';
import { renderOverview, renderListing } from './details.js';
import * as d3 from 'd3';

const loader = new DataLoader();

// Seletores do Slider de Rating
const ratingMinEl = document.querySelector('#rating-min');
const ratingMaxEl = document.querySelector('#rating-max');
const lblMin = document.querySelector('#lbl-rating-min');
const lblMax = document.querySelector('#lbl-rating-max');

const detailsEl = document.querySelector('#details');
const statusEl = document.querySelector('#filter-status');
const loadingEl = document.querySelector('#loading');
const clearBtn = document.querySelector('#clear-filters');
const activeFilterCountEl = document.querySelector('#active-filter-count');
const cityFilterEl = document.querySelector('#city-filter');

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

const detailMapView = createDetailMap('#detail-map', {
    onSelect: (d) => setSelection(d.listing_id)
});
let lastDetailMapListingId = null; // evita recentralizar o zoom em todo re-render do MESMO imóvel

function activeBinLabel(filters) {
    if (!filters.priceRange) return null;
    const [min, max] = filters.priceRange;
    const bin = PRICE_BINS.find((b) => b.min === min && (b.max === Infinity ? max === 1e9 : b.max === max));
    return bin ? bin.label : null;
}

const selectedCities = new Set();
function buildCityChips(cities) {
    if (!cityFilterEl) return;
    cityFilterEl.innerHTML = '';
    selectedCities.clear();

    cities.forEach(({ city, n }) => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'city-chip';
        chip.textContent = `${city} (${n})`;

        chip.addEventListener('click', () => {
            if (selectedCities.has(city)) selectedCities.delete(city);
            else selectedCities.add(city);
            chip.classList.toggle('active');
            updateFilters({ cities: selectedCities.size > 0 ? Array.from(selectedCities) : null });
        });
        cityFilterEl.appendChild(chip);
    });
}

function clearCityChips() {
    selectedCities.clear();
    cityFilterEl?.querySelectorAll('.city-chip.active').forEach((el) => el.classList.remove('active'));
}

const clearBtnDefaultText = clearBtn ? clearBtn.textContent : '';
let clearFeedbackTimeout = null;

function showClearFeedback() {
    if (!clearBtn) return;
    clearTimeout(clearFeedbackTimeout);
    clearBtn.textContent = '✓ Filtros limpos';
    clearBtn.classList.add('clear-btn-confirmed');
    clearFeedbackTimeout = setTimeout(() => {
        clearBtn.textContent = clearBtnDefaultText;
        clearBtn.classList.remove('clear-btn-confirmed');
    }, 1100);
}

function countActiveFilters(filters) {
    let n = 0;
    if (filters.cities && filters.cities.length > 0) n++;
    if (filters.priceRange) n++;
    if (filters.bbox) n++;
    if (filters.dateRange) n++;
    if (filters.ratingRange) n++; // Incluído o filtro de avaliação na contagem!
    return n;
}

function updateActiveFilterCount(filters) {
    if (!activeFilterCountEl) return;
    const n = countActiveFilters(filters);
    if (n === 0) {
        activeFilterCountEl.textContent = '';
        activeFilterCountEl.style.display = 'none';
    } else {
        activeFilterCountEl.textContent = n === 1 ? '1 filtro ativo' : `${n} filtros ativos`;
        activeFilterCountEl.style.display = 'inline';
    }
}

function formatStatus(summary) {
    if (!statusEl) return;
    const n = summary?.n_listings ?? 0;
    statusEl.textContent = n === 1 ? '1 imóvel no filtro atual' : `${n} imóveis no filtro atual`;
}

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
    updateActiveFilterCount(filters);

    if (selection) {
        const listing = await loader.listingDetails(selection);
        if (myRequest !== requestId) return;
        renderListing(detailsEl, listing, { onClose: () => setSelection(null) });
        
        // Repassa o 'filters' para o mapa de detalhe
        await updateDetailMap(listing, filters, myRequest); 
    } else {
        renderOverview(detailsEl, { summary, neighbourhoods });
        detailMapView.reset();
        lastDetailMapListingId = null;
    }
}

async function updateDetailMap(listing, filters, myRequest) {
    if (!listing || listing.latitude == null || listing.longitude == null) {
        detailMapView.reset();
        return;
    }
    
    const cityPoints = await loader.listingsInCity(listing.city, filters, listing.listing_id);
    
    if (myRequest !== requestId) return;
    const isNewSelection = lastDetailMapListingId !== listing.listing_id;
    detailMapView.update(cityPoints, listing.listing_id, isNewSelection);
    lastDetailMapListingId = listing.listing_id;
}

// --- LÓGICA DOS SLIDERS DE RATING ---

function handleRatingChange() {
    const minVal = Number(ratingMinEl.value);
    const maxVal = Number(ratingMaxEl.value);
    
    // Proteção: não deixa o mínimo ser maior que o máximo
    if (minVal > maxVal) {
        if (this.id === 'rating-min') {
            ratingMaxEl.value = minVal;
            if (lblMax) lblMax.textContent = minVal;
        } else {
            ratingMinEl.value = maxVal;
            if (lblMin) lblMin.textContent = maxVal;
        }
    }

    const finalMin = Number(ratingMinEl.value);
    const finalMax = Number(ratingMaxEl.value);

    // Atualiza o estado global
    updateFilters({ ratingRange: [finalMin, finalMax] });
}

// Atualiza o texto em tempo real ao arrastar
ratingMinEl?.addEventListener('input', () => {
    if (lblMin) lblMin.textContent = ratingMinEl.value;
});
ratingMaxEl?.addEventListener('input', () => {
    if (lblMax) lblMax.textContent = ratingMaxEl.value;
});

// Executa o filtro no banco ao soltar o clique
ratingMinEl?.addEventListener('change', handleRatingChange);
ratingMaxEl?.addEventListener('change', handleRatingChange);

// --- LÓGICA DO BOTÃO LIMPAR FILTROS ---
clearBtn?.addEventListener('click', () => {
    mapView.clearBrush();
    timelineView.clearBrush();
    clearCityChips();
    
    // Reseta os valores numéricos e os rótulos dos sliders
    if (ratingMinEl) { 
        ratingMinEl.value = 0; 
        if (lblMin) lblMin.textContent = '0'; 
    }
    if (ratingMaxEl) { 
        ratingMaxEl.value = 100; 
        if (lblMax) lblMax.textContent = '100'; 
    }
    
    clearFilters();
    showClearFeedback();
});

async function main() {
    subscribe(renderAll);

    await loader.init();
    await loader.loadAirbnb();

    const cities = await loader.listCities();
    buildCityChips(cities);

    if (loadingEl) loadingEl.style.display = 'none';

    await renderAll(getState());

    window.loader = loader;
}

window.addEventListener('DOMContentLoaded', () => {
    main().catch((err) => {
        console.error(err);
        if (loadingEl) loadingEl.textContent = 'Erro ao carregar os dados';
    });
});