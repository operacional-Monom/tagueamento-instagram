const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const { processarVerificacoesApi } = require('./verificador');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname)); // <-- Serve os HTMLs para o navegador

const JOBS_DIR = path.join(process.cwd(), 'jobs');

// =========================================================
// Busca Caminho do Navegador (Chrome / Edge)
// =========================================================
function getChromePath() {
    const commonPaths = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
    ];
    for (const p of commonPaths) {
        if (fs.existsSync(p)) return p;
    }
    return undefined;
}

// =========================================================
// Rota de Login Manual
// =========================================================
app.get('/api/login', async (req, res) => {
    try {
        const customPath = getChromePath();
        const launchOptions = {
            headless: false, // ABRE A TELA PRA PESSOA LOGAR
            defaultViewport: null,
            userDataDir: path.join(process.cwd(), 'insta_session'), 
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        };

        if (customPath) launchOptions.executablePath = customPath;

        const browser = await puppeteer.launch(launchOptions);
        const page = await browser.newPage();
        await page.goto('https://www.instagram.com/');
        res.json({ mensagem: "Navegador aberto! Faça login e feche a aba." });
        
        // Fica observando o navegador, quando o usuário fechar o puppeteer limpa o processo
        browser.on('disconnected', () => {
            console.log("Tela de login fechada.");
        });

    } catch (e) {
        res.status(500).json({ erro: e.message });
    }
});

// Cria pasta temporária de jobs caso não exista
if (!fs.existsSync(JOBS_DIR)) {
    fs.mkdirSync(JOBS_DIR);
}

// =========================================================
// Rota Secundária: Retorna Status do Job
// =========================================================
app.get('/api/status/:id', (req, res) => {
    const { id } = req.params;
    const filePath = path.join(JOBS_DIR, `${id}.json`);

    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ erro: "Job não encontrado ou ID inválido." });
    }

    try {
        const jobData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        res.json(jobData);
    } catch (e) {
        res.status(500).json({ erro: "Erro ao ler o status do job." });
    }
});

// =========================================================
// Helper para extrair apenas o '@usuario' ou o nome do Link
// =========================================================
function extrairUsuario(texto) {
    let t = String(texto).replace('@', '').trim().toLowerCase();
    if (t.includes('instagram.com/')) {
        t = t.replace(/\/$/, '').split('/').filter(Boolean).pop().split('?')[0];
    }
    return t;
}

// =========================================================
// Rota Principal: Iniciar Análise Assíncrona
// =========================================================
app.post('/api/iniciar', (req, res) => {
    let { contas, alvo, tipoAnalise, apiKey } = req.body;

    if (!contas || !Array.isArray(contas) || contas.length === 0) {
        return res.status(400).json({ erro: "Lista de contas não enviada ou inválida." });
    }

    if (!alvo) {
        return res.status(400).json({ erro: "Alvo da verificação não enviado." });
    }

    // Limpa alvo e contas (mantém a exata quantidade de linhas mesmo se vazias ou com erro)
    alvo = extrairUsuario(alvo);
    contas = contas.map(c => {
        let extr = extrairUsuario(c);
        if (!extr) return c; // Se nao conseguir extrair (ex: linha vazia), retorna o próprio valor original
        return extr;
    });

    const jobId = crypto.randomUUID();
    
    // Calcula o tempo estimado: 
    const contasCount = contas.length;
    // Otimização: processa 6 contas em paralelo numa única aba por conta
    const mediaPorCicloSegundos = 18; 
    const tempoEstimadoSegundos = Math.ceil(contasCount / 6) * mediaPorCicloSegundos;

    // Estado inicial
    const jobInicial = {
        id: jobId,
        status: "PROCESSANDO",
        alvo: alvo,
        totalContas: contasCount,
        progresso: 0,
        tempoEstimadoSegundos: tempoEstimadoSegundos,
        resultados: [],
        dataInicio: new Date().toISOString()
    };

    const filePath = path.join(JOBS_DIR, `${jobId}.json`);
    fs.writeFileSync(filePath, JSON.stringify(jobInicial, null, 2));

    // Retorna imediatamente para o front-end! Para não dar TIME OUT no navegador do usuário
    res.json({
        mensagem: "Análise iniciada com sucesso em segundo plano.",
        id_protocolo: jobId,
        total_contas: contasCount,
        tempo_estimado_segundos: tempoEstimadoSegundos,
        url_status: `/api/status/${jobId}`
    });

    // Roda em background! (Sem o await travando a rota)
    processarVerificacoesApi(contas, alvo, tipoAnalise, jobId, apiKey, (resultadosCompletos, concluidos) => {
        // Callback de atualização - Atualiza o JSON local enquanto o job ainda tá rodando
        const jobAtual = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        jobAtual.resultados = resultadosCompletos;
        jobAtual.progresso = concluidos;
        fs.writeFileSync(filePath, JSON.stringify(jobAtual, null, 2));
    }).then((resultadosEstaveis) => {
        // Concluído!
        const jobFinal = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        jobFinal.status = "CONCLUIDO";
        jobFinal.resultados = resultadosEstaveis;
        jobFinal.progresso = resultadosEstaveis.length;
        jobFinal.dataFim = new Date().toISOString();
        
        fs.writeFileSync(filePath, JSON.stringify(jobFinal, null, 2));
        console.log(`[JOB ${jobId}] Finalizado!`);
    }).catch((err) => {
        // Falhou!
        console.error(`[JOB ${jobId}] Erro no processamento:`, err);
        const jobFalho = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        jobFalho.status = "ERRO_INTERNO";
        fs.writeFileSync(filePath, JSON.stringify(jobFalho, null, 2));
    });
});

// =========================================================
// Inicialização
// =========================================================
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor Principal rodando na porta ${PORT}`);
    console.log(`📌 Rota POST /api/iniciar configurada`);
    console.log(`📌 Rota GET /api/status/:id configurada`);

    // Iniciar o servidor do classificador também
    try {
        require('./projeto-classificador/server.js');
    } catch(e) {
        console.error("Erro ao iniciar servidor secundario:", e.message);
    }

    // Abrir navegador automaticamente
    const { exec } = require('child_process');
    console.log("Abrindo navegador em http://localhost:3000 ...");
    setTimeout(() => {
        exec('start http://localhost:3000/index.html');
    }, 1500); 
});

