import { loadDb } from './config.js';
// classe para gerenciar o DuckDB WASM, carregar dados e executar consultas
export class DataLoader {
    async init() {
        this.db = await loadDb();
        this.conn = await this.db.connect();
        this.table = 'sales';
  }

    // carrega o CSV único (ou vários arquivos) para o FS virtual e cria tabela
    async loadCSV(path = '/data.csv') {
        // verifica se o banco e a conexão estão prontos
        if (!this.db || !this.conn) throw new Error('Banco de dados não inicializado. Chame init() primeiro.');

        // fetch do arquivo CSV e registra no FS virtual do DuckDB
        const resp = await fetch(path);

        // converte o arquivo para um buffer e registra com uma chave (nome) qualquer
        const buf = new Uint8Array(await resp.arrayBuffer());

        // registra com uma chave (nome) qualquer
        await this.db.registerFileBuffer('data.csv', buf);

        // cria a tabela a partir do CSV usando a função read_csv_auto do DuckDB
        await this.conn.query(`
            CREATE TABLE ${this.table} AS
            SELECT * FROM read_csv_auto('data.csv');
            `);
    }

    // função genérica para executar consultas SQL e retornar resultados como array de objetos
    async query(sql) {
        // verifica se o banco e a conexão estão prontos
        if (!this.db || !this.conn) throw new Error('Banco de dados não inicializado. Chame init() primeiro.');
        
        // executa a consulta SQL e retorna os resultados
        const res = await this.conn.query(sql);
        
        // utiliza ToArray e ToJSON para converter os resultados em um formato mais fácil de usar (array de objetos)
        return res.toArray().map(r => r.toJSON());
    }

    // exemplo: agregação por ano e tipo (igual ao que precisa para o gráfico)
    async aggregatedByYearType() {
        const sql = `
            SELECT ano, tipo, SUM(valor) AS valor
            FROM ${this.table}
            GROUP BY ano, tipo
            ORDER BY ano, tipo;
            `;
        return this.query(sql);
    }
}
