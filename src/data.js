import { loadDb } from './config.js';

// Faixas de preço fixas usadas no histograma, EM USD (ver price_usd em
// listings_clean). Ficam fixas (em vez de recalculadas a cada filtro) para
// que o eixo X do histograma não "pule" quando o usuário aplica um filtro —
// só a altura das barras muda.
export const PRICE_BINS = [
    { min: 0, max: 25, label: '0–25' },
    { min: 25, max: 50, label: '25–50' },
    { min: 50, max: 75, label: '50–75' },
    { min: 75, max: 100, label: '75–100' },
    { min: 100, max: 150, label: '100–150' },
    { min: 150, max: 250, label: '150–250' },
    { min: 250, max: 400, label: '250–400' },
    { min: 400, max: 700, label: '400–700' },
    { min: 700, max: Infinity, label: '700+' },
];

// Limite de pontos no mapa para evitar renderização excessiva e lag.
export const MAX_MAP_POINTS_PER_CITY = 5000; // controla o número de pontos por cidade
export const MAX_DETAIL_MAP_POINTS = 2500; // controla a riqueza de detalhes

// Monta a cláusula WHERE compartilhada por (quase) todas as consultas, a
// partir do objeto de filtros guardado em state.js.
export function buildWhereClause(filters = {}) {
    const clauses = ['1=1'];

    // Filtro de cidade (where)
    if (filters.cities && filters.cities.length > 0) {
        const list = filters.cities.map((c) => `'${String(c).replace(/'/g, "''")}'`).join(',');
        clauses.push(`l.city IN (${list})`);
    }

    // Filtro de preço (what)
    if (filters.priceRange) {
        const [min, max] = filters.priceRange;
        clauses.push(`l.price_usd BETWEEN ${Number(min)} AND ${Number(max)}`);
    }

    // Filtro de mapa/região (where geográfico)
    if (filters.bbox) {
        const { city, bbox } = filters.bbox;
        const { lonMin, lonMax, latMin, latMax } = bbox;
        if (city) {
            clauses.push(`l.city = '${String(city).replace(/'/g, "''")}'`);
        }
        clauses.push(`l.longitude BETWEEN ${Number(lonMin)} AND ${Number(lonMax)}`);
        clauses.push(`l.latitude BETWEEN ${Number(latMin)} AND ${Number(latMax)}`);
    }

    // Filtro de tempo (when)
    if (filters.dateRange) {
        const [start, end] = filters.dateRange;
        clauses.push(`EXISTS (
            SELECT 1 FROM reviews_clean AS r
            WHERE r.listing_id = l.listing_id
              AND r.date_parsed BETWEEN DATE '${start}' AND DATE '${end}'
        )`);
    }

    if (filters.ratingRange) {
        const [min, max] = filters.ratingRange;
        clauses.push(`l.review_scores_rating BETWEEN ${Number(min)} AND ${Number(max)}`);
    }

    return clauses.join(' AND ');
}

// DataLoader: carrega Listings/Reviews no DuckDB-WASM e expõe as consultas.
export class DataLoader {
    async init() {
        this.db = await loadDb();
        this.conn = await this.db.connect();
    }

    async loadAirbnb(listingsPath = '/Airbnb Data/Listings.csv', reviewsPath = '/Airbnb Data/Reviews.csv') {
        if (!this.db || !this.conn) throw new Error('Banco não inicializado. Chame init() primeiro.');

        const [r1, r2] = await Promise.all([fetch(listingsPath), fetch(reviewsPath)]);
        if (!r1.ok) throw new Error(`Falha ao buscar ${listingsPath} (${r1.status})`);
        if (!r2.ok) throw new Error(`Falha ao buscar ${reviewsPath} (${r2.status})`);

        const [buf1, buf2] = await Promise.all([r1.arrayBuffer(), r2.arrayBuffer()]);
        await this.db.registerFileBuffer('Listings.csv', new Uint8Array(buf1));
        await this.db.registerFileBuffer('Reviews.csv', new Uint8Array(buf2));

        await this.conn.query(`
            CREATE OR REPLACE TABLE listings_raw AS
            SELECT * FROM read_csv_auto('Listings.csv', SAMPLE_SIZE=-1);
        `);

        await this.conn.query(`
            CREATE OR REPLACE TABLE reviews_raw AS
            SELECT * FROM read_csv_auto('Reviews.csv', SAMPLE_SIZE=-1);
        `);

        await this.conn.query(`
            CREATE OR REPLACE VIEW listings_clean AS
            SELECT
                listing_id,
                name,
                neighbourhood,
                district,
                city,
                property_type,
                room_type,
                accommodates,
                bedrooms,
                TRY_CAST(REPLACE(REPLACE(CAST(price AS VARCHAR), '$', ''), ',', '') AS DOUBLE) AS price,
                TRY_CAST(REPLACE(REPLACE(CAST(price AS VARCHAR), '$', ''), ',', '') AS DOUBLE) / CASE city
                    WHEN 'Paris' THEN 0.825
                    WHEN 'Rome' THEN 0.825
                    WHEN 'New York' THEN 1.00
                    WHEN 'Sydney' THEN 1.29
                    WHEN 'Rio de Janeiro' THEN 5.40
                    WHEN 'Istanbul' THEN 7.00
                    WHEN 'Mexico City' THEN 20.0
                    WHEN 'Bangkok' THEN 30.0
                    WHEN 'Cape Town' THEN 14.8
                    WHEN 'Hong Kong' THEN 7.75
                    ELSE 1.00
                END AS price_usd,
                minimum_nights,
                maximum_nights,
                TRY_CAST(latitude AS DOUBLE) AS latitude,
                TRY_CAST(longitude AS DOUBLE) AS longitude,
                TRY_CAST(review_scores_rating AS DOUBLE) AS review_scores_rating,
                TRY_CAST(review_scores_accuracy AS DOUBLE) AS review_scores_accuracy,
                TRY_CAST(review_scores_cleanliness AS DOUBLE) AS review_scores_cleanliness,
                TRY_CAST(review_scores_checkin AS DOUBLE) AS review_scores_checkin,
                TRY_CAST(review_scores_communication AS DOUBLE) AS review_scores_communication,
                TRY_CAST(review_scores_location AS DOUBLE) AS review_scores_location,
                TRY_CAST(review_scores_value AS DOUBLE) AS review_scores_value,
                host_id,
                host_since,
                host_is_superhost,
                host_identity_verified,
                instant_bookable
            FROM listings_raw
            WHERE TRY_CAST(latitude AS DOUBLE) IS NOT NULL
              AND TRY_CAST(longitude AS DOUBLE) IS NOT NULL
              AND TRY_CAST(REPLACE(REPLACE(CAST(price AS VARCHAR), '$', ''), ',', '') AS DOUBLE) IS NOT NULL;
        `);

        await this.conn.query(`
            CREATE OR REPLACE VIEW reviews_clean AS
            SELECT
                TRY_CAST(listing_id AS BIGINT) AS listing_id,
                review_id,
                TRY_CAST(date AS DATE) AS date_parsed
            FROM reviews_raw
            WHERE TRY_CAST(listing_id AS BIGINT) IS NOT NULL;
        `);
    }

    // *** REMOVIDO: fixEncoding() ***
    // Existia uma função aqui que tentava corrigir "mojibake" usando
    // decodeURIComponent(escape(str)) com fallback de cortar caracteres
    // até parar de dar erro. O problema: escape()/decodeURIComponent()
    // assumem Latin-1, não UTF-8 — qualquer string que já estivesse
    // CORRETAMENTE acentuada em UTF-8 (que é o caso de toda a amostra
    // gerada para este projeto, conferido diretamente nos CSVs) quebrava
    // ao passar por essa função: "São Paulo" virava só "S", porque o
    // primeiro caractere acentuado gerava um erro de "URI malformed", e
    // o fallback ia cortando o FINAL da string até o erro parar de
    // acontecer — o que, na prática, descartava quase tudo. Removida
    // porque (1) os dados já estão corretos em UTF-8 nesta amostra, e
    // (2) mesmo se não estivessem, essa técnica específica não era seguro
    // o suficiente para aplicar indiscriminadamente em qualquer string.

    // Executa SQL arbitrário e devolve um array de objetos JS simples.
    async query(sql) {
        if (!this.db || !this.conn) throw new Error('Banco não inicializado. Chame init() primeiro.');
        const res = await this.conn.query(sql);

        return res.toArray().map((row) => {
            const obj = row.toJSON();
            for (const key in obj) {
                // Corrige os BigInts para o D3 (Arrow devolve inteiros de
                // 64 bits como BigInt; +BigInt lança TypeError em escalas
                // do D3, então convertemos para Number aqui uma única vez).
                if (typeof obj[key] === 'bigint') obj[key] = Number(obj[key]);
            }
            return obj;
        });
    }

    // --- Consultas usadas pelas views coordenadas -------------------------

    async listingsForMap(filters = {}) {
    const where = buildWhereClause({ 
        cities: filters.cities, 
        priceRange: filters.priceRange, 
        dateRange: filters.dateRange,
        ratingRange: filters.ratingRange
    });
    const sql = `
        SELECT listing_id, name, city, neighbourhood, room_type, property_type,
               latitude, longitude, price, price_usd, review_scores_rating
        FROM (
            SELECT *, ROW_NUMBER() OVER (PARTITION BY city ORDER BY random()) AS rn
            FROM listings_clean AS l
            WHERE ${where}
        ) AS sampled
        WHERE rn <= ${MAX_MAP_POINTS_PER_CITY};
    `;
    return this.query(sql);
}

    async priceHistogram(filters = {}) {
        const where = buildWhereClause({ 
            cities: filters.cities, 
            bbox: filters.bbox, 
            dateRange: filters.dateRange,
            ratingRange: filters.ratingRange});
        const caseLines = PRICE_BINS.map((b) =>
            b.max === Infinity
                ? `WHEN l.price_usd >= ${b.min} THEN '${b.label}'`
                : `WHEN l.price_usd >= ${b.min} AND l.price_usd < ${b.max} THEN '${b.label}'`
        ).join('\n                ');

        const sql = `
            SELECT
                CASE
                ${caseLines}
                END AS bin_label,
                l.room_type,
                COUNT(*) AS n
            FROM listings_clean AS l
            WHERE ${where} AND l.price_usd IS NOT NULL
            GROUP BY bin_label, l.room_type;
        `;
        return this.query(sql);
    }

    async reviewsTimeSeries(filters = {}) {
    const where = buildWhereClause({ 
        cities: filters.cities, 
        priceRange: filters.priceRange, 
        bbox: filters.bbox,
        ratingRange: filters.ratingRange
    });
    const sql = `
        SELECT strftime(r.date_parsed, '%Y-%m') AS month, COUNT(*) AS n_reviews
        FROM reviews_clean AS r
        JOIN listings_clean AS l ON l.listing_id = r.listing_id
        WHERE r.date_parsed IS NOT NULL AND ${where}
        GROUP BY month
        ORDER BY month;
    `;
    return this.query(sql);
}

    async summaryStats(filters = {}) {
        const where = buildWhereClause(filters);
        const sql = `
            SELECT COUNT(*) AS n_listings,
                   AVG(l.price_usd) AS avg_price,
                   AVG(l.review_scores_rating) AS avg_rating
            FROM listings_clean AS l
            WHERE ${where};
        `;
        const rows = await this.query(sql);
        return rows[0];
    }

    async topNeighbourhoods(filters = {}, limit = 5) {
        const where = buildWhereClause(filters);
        const sql = `
            SELECT l.city, l.neighbourhood, COUNT(*) AS n_listings, AVG(l.price_usd) AS avg_price
            FROM listings_clean AS l
            WHERE ${where}
            GROUP BY l.city, l.neighbourhood
            ORDER BY n_listings DESC
            LIMIT ${Number(limit)};
        `;
        return this.query(sql);
    }

    async listCities() {
        const sql = `
            SELECT 
                city, 
                LEAST(COUNT(*), ${MAX_MAP_POINTS_PER_CITY}) AS n
            FROM listings_clean
            WHERE latitude IS NOT NULL AND longitude IS NOT NULL
            GROUP BY city
            ORDER BY n DESC;
        `;
        return this.query(sql);
    }

    async listingDetails(listingId) {
        const sql = `
            SELECT *
            FROM listings_clean
            WHERE listing_id = ${Number(listingId)}
            LIMIT 1;
        `;
        const rows = await this.query(sql);
        return rows[0] || null;
    }

    // Mapa de detalhe com os listings da MESMA cidade, respeitando os
    // filtros globais ativos — EXCETO para o próprio imóvel selecionado,
    // que sempre aparece mesmo se estiver fora do filtro atual (ex.: o
    // usuário aplicou um filtro de preço depois de já ter selecionado um
    // imóvel fora dessa faixa) — caso contrário o painel de detalhe
    // "perderia" o imóvel que o usuário está olhando.
    //
    // *** CLAREZA DE PRECEDÊNCIA SQL: os parênteses ao redor de cada
    // bloco abaixo são explícitos de propósito. Sem eles, "A AND B OR C"
    // ainda seria interpretado como "(A AND B) OR C" pela precedência
    // padrão de SQL (AND liga mais forte que OR) — ou seja, o
    // comportamento já seria o mesmo mesmo sem os parênteses. Mas deixar
    // implícito é uma armadilha de manutenção: qualquer pessoa que
    // adicionar uma nova condição aqui no futuro, sem prestar atenção à
    // precedência, pode facilmente introduzir um bug real. ***
    async listingsInCity(city, filters = {}, selectedListingId = null) {
        const baseWhere = buildWhereClause({ ...filters, cities: [city] });
        const selectedId = selectedListingId != null ? Number(selectedListingId) : null;
        // o próprio imóvel selecionado entra na amostra mesmo sem
        // coordenadas válidas (ex.: caso raro de lat/lon nulos) — mas
        // detailMap.js já filtra `longitude/latitude != null` antes de
        // desenhar, então isso não quebra o desenho, só evita que a
        // query e o painel "percam" o imóvel por completo.
        const selectedClause = selectedId != null ? ` OR l.listing_id = ${selectedId}` : '';

        const sql = `
            SELECT listing_id, name, city, neighbourhood, room_type, property_type,
                   latitude, longitude, price_usd, review_scores_rating
            FROM (
                SELECT *, ROW_NUMBER() OVER (ORDER BY random()) AS rn
                FROM listings_clean AS l
                WHERE (
                    (${baseWhere})
                    AND l.latitude IS NOT NULL AND l.longitude IS NOT NULL
                )
                ${selectedClause}
            ) AS sampled
            WHERE (rn <= ${MAX_DETAIL_MAP_POINTS})
               OR (listing_id = ${selectedId != null ? selectedId : 'NULL'});
        `;
        return this.query(sql);
    }
}