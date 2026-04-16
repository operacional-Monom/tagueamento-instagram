const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

async function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Alvos fixos do classificador político
const targetsDireita = ['jairmessiasbolsonaro', 'flaviobolsonaro', 'bolsonarosp', 'carlosbolsonaro', 'michellebolsonaro'];
const targetsEsquerda = ['lulaoficial', 'ptbrasil'];

// ============================================================
// Processa UMA conta — abre aba, verifica e fecha
// ============================================================
async function classificarConta(browser, nomeConta) {
    const page = await browser.newPage();
    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36");

    try {
        await page.goto(`https://www.instagram.com/${nomeConta}/`, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await page.waitForSelector('header', { timeout: 8000 }).catch(() => null);

        const existe = await page.$('header');
        if (!existe) throw new Error("Página não encontrada.");

        const followingLink = await page.$(`a[href="/${nomeConta}/following/"]`);
        if (!followingLink) {
            return `[ PRIVADA/INEXISTENTE ] @${nomeConta}`;
        }

        await followingLink.click();
        await page.waitForSelector('div[role="dialog"]', { timeout: 10000 });
        await delay(1500);

        await page.waitForSelector('div[role="dialog"] input[type="text"]', { timeout: 8000 });
        const searchInput = await page.$('div[role="dialog"] input[type="text"]');

        if (!searchInput) {
            return `[ ERRO ] Barra de busca não encontrada em @${nomeConta}.`;
        }

        // Função interna de buscar alvos
        const buscaAlvos = async (targets) => {
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

                    if (segueOAlvo) return true; 
                } catch (e) {
                    console.log(`Erro interno buscando ${alvo} em @${nomeConta}:`, e.message);
                }
            }
            return false;
        };

        // 1) Direita
        let isDireita = await buscaAlvos(targetsDireita);
        if (isDireita) {
            return `[ DIREITA ] @${nomeConta}`;
        }

        // 2) Esquerda
        let isEsquerda = await buscaAlvos(targetsEsquerda);
        if (isEsquerda) {
            return `[ ESQUERDA ] @${nomeConta}`;
        }

        return `[ INDEFINIDO ] @${nomeConta}`;

    } catch (err) {
        return `[ ERRO ] @${nomeConta}: ${err.message}`;
    } finally {
        await page.close().catch(() => { });
    }
}

// ============================================================
// Execução controlada para API
// ============================================================
async function processarVerificacoesApi(contas, jobId, callbackAtualizacao) {
    console.log(`[JOB ${jobId}] Iniciando CLASSIFICADOR POLÍTICO para ${contas.length} contas.`);
    
    let browser;
    let resultadosExtraidos = [];
    
    try {
        // Usa a sessão da pasta superior (../insta_session) pra não precisar relogar
        const sessionPath = path.resolve(__dirname, '../insta_session');
        
        browser = await puppeteer.launch({
            headless: false, 
            defaultViewport: { width: 1280, height: 900 },
            userDataDir: sessionPath, 
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,900']
        });

        const loginPage = await browser.newPage();
        await loginPage.goto('https://www.instagram.com/', { waitUntil: 'networkidle2' });
        await delay(3000);
        await loginPage.close();

        const fila = [...contas];
        const concorrencia = 2; // Mantido em 2 abas
        let em_andamento = 0;
        let indice = 0;

        return new Promise((resolve) => {
            function iniciarProxima() {
                if (indice >= fila.length && em_andamento === 0) {
                    browser.close().then(() => resolve(resultadosExtraidos)).catch(()=> resolve(resultadosExtraidos));
                    return;
                }

                while (em_andamento < concorrencia && indice < fila.length) {
                    let nomeContaRaw = fila[indice].trim();
                    let nomeConta = nomeContaRaw.replace('@', '').trim().toLowerCase();
                    if (nomeConta.includes('instagram.com/')) {
                        nomeConta = nomeConta.replace(/\/$/, '').split('/').filter(Boolean).pop().split('?')[0];
                    }
                    
                    if (!nomeConta) {
                        indice++; 
                        continue;
                    }

                    indice++;
                    em_andamento++;

                    classificarConta(browser, nomeConta)
                        .then((resTexto) => {
                            em_andamento--;
                            resultadosExtraidos.push(resTexto); 
                            if(callbackAtualizacao) callbackAtualizacao(resultadosExtraidos);
                            setTimeout(iniciarProxima, 2500);
                        })
                        .catch((e) => {
                            em_andamento--;
                            resultadosExtraidos.push(`[ ERRO EXTREMO ] @${nomeConta}: ${e.message}`);
                            if(callbackAtualizacao) callbackAtualizacao(resultadosExtraidos);
                            setTimeout(iniciarProxima, 2500);
                        });
                }
            }

            iniciarProxima();
        });

    } catch (error) {
        console.error(`[JOB ${jobId}] Erro catastrófico:`, error);
        if (browser) await browser.close().catch(()=>{});
        return resultadosExtraidos;
    }
}

module.exports = {
    processarVerificacoesApi
};
