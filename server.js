const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const { processarVerificacoesApi } = require('./verificador');

const app = express();
app.use(cors());
app.use(express.json());

const JOBS_DIR = path.join(__dirname, 'jobs');

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
    let { contas, alvo } = req.body;

    if (!contas || !Array.isArray(contas) || contas.length === 0) {
        return res.status(400).json({ erro: "Lista de contas não enviada ou inválida." });
    }

    if (!alvo) {
        return res.status(400).json({ erro: "Alvo da verificação não enviado." });
    }

    // Limpa alvo e contas caso venham com link
    alvo = extrairUsuario(alvo);
    contas = contas.map(extrairUsuario).filter(c => c);

    const jobId = uuidv4();
    
    // Calcula o tempo estimado: 
    // Com concorrência 2 e delays do Puppeteer: média de ~6 segundos por conta (na pior das hipóteses 8s)
    const contasCount = contas.length;
    // Como são 2 por vez: num_ciclos * tempo_por_ciclo
    const mediaPorCicloSegundos = 10;
    const tempoEstimadoSegundos = Math.ceil(contasCount / 2) * mediaPorCicloSegundos;

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
    processarVerificacoesApi(contas, alvo, jobId, (resultadosParciais) => {
        // Callback de atualização - Atualiza o JSON local enquanto o job ainda tá rodando
        const jobAtual = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        jobAtual.resultados = resultadosParciais;
        jobAtual.progresso = resultadosParciais.length;
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
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
    console.log(`📌 Rota POST /api/iniciar configurada`);
    console.log(`📌 Rota GET /api/status/:id configurada`);
});
