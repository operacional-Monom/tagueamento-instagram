const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

async function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Alvos fixos do classificador político
const targetsDireita = ['jairmessiasbolsonaro', 'flaviobolsonaro', 'bolsonarosp', 'carlosbolsonaro', 'michellebolsonaro'];
const targetsEsquerda = ['lulaoficial', 'ptbrasil', 'lulapelaverdade'];

// ============================================================
// Processa UMA aba de verificação para um conjunto de alvos
// ============================================================
async function verificarAlvosEmAba(browser, nomeConta, targets) {
    const page = await browser.newPage();
    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36");

    try {
        await page.goto(`https://www.instagram.com/${nomeConta}/`, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await page.waitForSelector('header', { timeout: 8000 }).catch(() => null);

        const existe = await page.$('header');
        if (!existe) return { erro: "Página não encontrada." };

        const followingLink = await page.$(`a[href="/${nomeConta}/following/"]`);
        if (!followingLink) {
            return { erro: "PRIVADA/INEXISTENTE" };
        }

        await followingLink.click();
        await page.waitForSelector('div[role="dialog"]', { timeout: 10000 });
        await delay(1500);

        await page.waitForSelector('div[role="dialog"] input[type="text"]', { timeout: 8000 });
        const searchInput = await page.$('div[role="dialog"] input[type="text"]');

        if (!searchInput) {
            return { erro: "Barra de busca não encontrada." };
        }

        for (let alvo of targets) {
            try {
                await searchInput.click({ clickCount: 3 });
                await page.keyboard.press('Backspace');
                await delay(400);

                await searchInput.type(alvo, { delay: 80 });
                await delay(2500); 

                const segueOAlvo = await page.evaluate((al) => {
                    const links = Array.from(document.querySelectorAll('div[role="dialog"] a'));
                    return links.some(link => {
                        const href = link.getAttribute('href');
                        return href && href.includes(`/${al}/`);
                    });
                }, alvo);

                if (segueOAlvo) return { match: true }; 
            } catch (e) {
                console.log(`Erro interno buscando ${alvo} em @${nomeConta}:`, e.message);
            }
        }
        return { match: false };

    } catch (err) {
        return { erro: err.message };
    } finally {
        await page.close().catch(() => { });
    }
}

// ============================================================
// Processa a conta verificando Direita e Esquerda em 2 abas
// ============================================================
async function classificarConta(browser, nomeConta) {
    console.log(`[JOB] Analisando @${nomeConta} (Abrindo 2 abas simultâneas...)`);
    
    // Executa as duas consultas em paralelo nas duas abas
    const [resultadoDireita, resultadoEsquerda] = await Promise.all([
        verificarAlvosEmAba(browser, nomeConta, targetsDireita),
        verificarAlvosEmAba(browser, nomeConta, targetsEsquerda)
    ]);

    const isDireita = resultadoDireita.match === true;
    const isEsquerda = resultadoEsquerda.match === true;

    // Regras de negócio da Classificação
    if (isDireita && isEsquerda) {
        return `[ CENTRO ] @${nomeConta}`;
    } else if (isDireita) {
        return `[ DIREITA ] @${nomeConta}`;
    } else if (isEsquerda) {
        return `[ ESQUERDA ] @${nomeConta}`;
    }

    // Gerenciamento de erro caso dê problema de log ou restrição nalguma página
    if (resultadoDireita.erro && resultadoEsquerda.erro) {
        // Se ambos falharam, retorna o que deu priv/inexistente ou erro normal
        if (resultadoDireita.erro === "PRIVADA/INEXISTENTE") return `[ PRIVADA/INEXISTENTE ] @${nomeConta}`;
        return `[ ERRO ] @${nomeConta}: ${resultadoDireita.erro}`;
    }

    if (resultadoDireita.erro) {
        if (resultadoDireita.erro === "PRIVADA/INEXISTENTE") return `[ PRIVADA/INEXISTENTE ] @${nomeConta}`;
        return `[ ERRO ] @${nomeConta}: falha na aba Direita - ${resultadoDireita.erro}`;
    }

    if (resultadoEsquerda.erro) {
        if (resultadoEsquerda.erro === "PRIVADA/INEXISTENTE") return `[ PRIVADA/INEXISTENTE ] @${nomeConta}`;
        return `[ ERRO ] @${nomeConta}: falha na aba Esquerda - ${resultadoEsquerda.erro}`;
    }

    return `[ INDEFINIDO ] @${nomeConta}`;
}

// ============================================================
// Busca Caminho do Navegador (Chrome / Edge)
// ============================================================
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
    return undefined; // se não achar, deixa puppeteer tentar sozinho
}

// ============================================================
// Execução controlada para API
// ============================================================
async function processarVerificacoesApi(contas, jobId, callbackAtualizacao) {
    console.log(`[JOB ${jobId}] Iniciando CLASSIFICADOR POLÍTICO para ${contas.length} contas.`);
    
    let browser;
    // Pré-aloca um array com o mesmo tamanho pra manter a ordem
    let resultadosExtraidos = new Array(contas.length).fill(null);
    let contasFinalizadas = 0;
    
    try {
        const sessionPath = path.join(process.cwd(), 'insta_session');
        const customPath = getChromePath();
        const launchOptions = {
            headless: "new", // Alterado para segundo plano invisível
            defaultViewport: { width: 1280, height: 900 },
            userDataDir: sessionPath, 
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,900']
        };

        if (customPath) {
            launchOptions.executablePath = customPath;
        }

        browser = await puppeteer.launch(launchOptions);

        const loginPage = await browser.newPage();
        await loginPage.goto('https://www.instagram.com/', { waitUntil: 'networkidle2' });
        await delay(3000);
        await loginPage.close();

        const fila = [...contas];
        const concorrencia = 3; // 3 contas em paralelo = 6 abas simultâneas
        let em_andamento = 0;
        let indice_global = 0;

        return new Promise((resolve) => {
            function iniciarProxima() {
                if (contasFinalizadas >= fila.length) {
                    browser.close().then(() => resolve(resultadosExtraidos)).catch(()=> resolve(resultadosExtraidos));
                    return;
                }

                while (em_andamento < concorrencia && indice_global < fila.length) {
                    let idx_atual = indice_global; // Captura o índice para não embaralhar
                    let nomeContaRaw = fila[idx_atual].trim();
                    let nomeConta = nomeContaRaw.replace('@', '').trim().toLowerCase();
                    if (nomeConta.includes('instagram.com/')) {
                        nomeConta = nomeConta.replace(/\/$/, '').split('/').filter(Boolean).pop().split('?')[0];
                    }
                    
                    indice_global++;
                    
                    if (!nomeConta) {
                        resultadosExtraidos[idx_atual] = `[ ERRO ] Link vazio`;
                        contasFinalizadas++;
                        continue;
                    }

                    em_andamento++;

                    classificarConta(browser, nomeConta)
                        .then((resTexto) => {
                            em_andamento--;
                            resultadosExtraidos[idx_atual] = resTexto; 
                            contasFinalizadas++;
                            if(callbackAtualizacao) callbackAtualizacao(resultadosExtraidos.filter(r => r !== null));
                            setTimeout(iniciarProxima, 2500);
                        })
                        .catch((e) => {
                            em_andamento--;
                            resultadosExtraidos[idx_atual] = `[ ERRO EXTREMO ] @${nomeConta}: ${e.message}`;
                            contasFinalizadas++;
                            if(callbackAtualizacao) callbackAtualizacao(resultadosExtraidos.filter(r => r !== null));
                            setTimeout(iniciarProxima, 2500);
                        });
                }
            }

            iniciarProxima();
        });

    } catch (error) {
        console.error(`[JOB ${jobId}] Erro catastrófico:`, error);
        if (browser) await browser.close().catch(()=>{});
        return resultadosExtraidos.filter(r => r !== null);
    }
}

module.exports = {
    processarVerificacoesApi
};
