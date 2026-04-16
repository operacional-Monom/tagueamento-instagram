const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const { processarVerificacoesApi } = require('./motor_classificador');

const app = express();
app.use(cors());
app.use(express.json());

const JOBS_DIR = path.join(__dirname, 'jobs');

if (!fs.existsSync(JOBS_DIR)) {
    fs.mkdirSync(JOBS_DIR);
}

app.get('/api/status-politica/:id', (req, res) => {
    const { id } = req.params;
    const filePath = path.join(JOBS_DIR, `${id}.json`);

    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ erro: "Job não encontrado ou ID inválido." });
    }

    try {
        const jobData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        res.json(jobData);
    } catch (e) {
        res.status(500).json({ erro: "Erro ao ler o status." });
    }
});

function extrairUsuario(texto) {
    let t = String(texto).replace('@', '').trim().toLowerCase();
    if (t.includes('instagram.com/')) {
        t = t.replace(/\/$/, '').split('/').filter(Boolean).pop().split('?')[0];
    }
    return t;
}

app.post('/api/classificar', (req, res) => {
    let { contas } = req.body;

    if (!contas || !Array.isArray(contas) || contas.length === 0) {
        return res.status(400).json({ erro: "Lista de contas não enviada." });
    }

    contas = contas.map(extrairUsuario).filter(c => c);

    const jobId = uuidv4();
    const contasCount = contas.length;
    // Mais demorado pois ele avalia múltiplos alvos para CADA conta!
    const tempoEstimadoSegundos = Math.ceil(contasCount / 2) * 20; 

    const jobInicial = {
        id: jobId,
        status: "PROCESSANDO",
        totalContas: contasCount,
        progresso: 0,
        tempoEstimadoSegundos: tempoEstimadoSegundos,
        resultados: [],
        dataInicio: new Date().toISOString()
    };

    const filePath = path.join(JOBS_DIR, `${jobId}.json`);
    fs.writeFileSync(filePath, JSON.stringify(jobInicial, null, 2));

    res.json({
        mensagem: "Classificação Política iniciada.",
        id_protocolo: jobId,
        total_contas: contasCount,
        tempo_estimado_segundos: tempoEstimadoSegundos,
        url_status: `/api/status-politica/${jobId}`
    });

    processarVerificacoesApi(contas, jobId, (resultadosParciais) => {
        const jobAtual = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        jobAtual.resultados = resultadosParciais;
        jobAtual.progresso = resultadosParciais.length;
        fs.writeFileSync(filePath, JSON.stringify(jobAtual, null, 2));
    }).then((resultadosEstaveis) => {
        const jobFinal = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        jobFinal.status = "CONCLUIDO";
        jobFinal.resultados = resultadosEstaveis;
        jobFinal.progresso = resultadosEstaveis.length;
        jobFinal.dataFim = new Date().toISOString();
        
        fs.writeFileSync(filePath, JSON.stringify(jobFinal, null, 2));
        console.log(`[POLITICA ${jobId}] Finalizado!`);
    }).catch((err) => {
        const jobFalho = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        jobFalho.status = "ERRO_INTERNO";
        fs.writeFileSync(filePath, JSON.stringify(jobFalho, null, 2));
    });
});

const PORT = 3001; // <--- PORTA DIFERENTE DO PRINCIPAL
app.listen(PORT, () => {
    console.log(`⚖️ Servidor Político rodando na porta ${PORT}`);
});
