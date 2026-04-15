poimport instaloader
import time

def main():
    print("Iniciando o verificador de seguidores do Instagram...")
    L = instaloader.Instaloader()
    
    print("\nAVISO MÁXIMO: Use apenas uma CONTA SECUNDÁRIA (falsa) para isso.")
    print("O Instagram bloqueia contas reais se fizer muitas buscas automáticas.\n")
    
    USER = "lindalvaconcs"
    PASSWORD = "Lindalva12345"
    try:
        # Fazendo login direto com as credenciais informadas
        L.login(USER, PASSWORD)
        print("Login realizado com sucesso!\n")
    except Exception as e:
        print(f"Erro ao fazer login. Verifique sua senha ou se a conta está bloqueada: {e}")
        return

    # A conta do Bolsonaro para checar se a pessoa segue
    TARGET_ACCOUNT = "jairmessiasbolsonaro"
    
    # Lê a lista de perfis do arquivo contas.txt
    try:
        with open("contas.txt", "r", encoding="utf-8") as f:
            perfis = [linha.strip() for linha in f if linha.strip()]
    except FileNotFoundError:
        print("Arquivo 'contas.txt' não encontrado na mesma pasta.")
        return

    if not perfis:
         print("O arquivo 'contas.txt' está vazio. Coloque o nome das contas lá.")
         return

    print(f"\nVerificando {len(perfis)} conta(s) para ver se seguem @{TARGET_ACCOUNT}...\n")
    
    # Abrir um arquivo para salvar os resultados
    with open("resultado.txt", "w", encoding="utf-8") as f_out:
        f_out.write("Relatório de Seguidores: @jairmessiasbolsonaro\n")
        f_out.write("=============================================\n")

        for perfil in perfis:
            perfil_clean = perfil.replace("@", "")
            try:
                # Carregar as informações do perfil que está na lista
                profile = instaloader.Profile.from_username(L.context, perfil_clean)
                
                print(f"Lendo as pessoas que @{perfil_clean} segue... (Isso pode demorar um pouco se ele seguir muita gente)")
                segue_alvo = False
                
                # O get_followees() retorna quem a pessoa SEGUE
                for followee in profile.get_followees():
                    if followee.username == TARGET_ACCOUNT:
                        segue_alvo = True
                        break
                        
                resultado_texto = f"[ SIM ] @{perfil_clean} SEGUE @{TARGET_ACCOUNT}" if segue_alvo else f"[ NÃO ] @{perfil_clean} NÃO segue @{TARGET_ACCOUNT}"
                print(resultado_texto)
                f_out.write(resultado_texto + "\n")
                
            except Exception as e:
                erro_texto = f"[ ERRO ] Não foi possível verificar @{perfil_clean}. Ele é Privado ou não existe? ({e})"
                print(erro_texto)
                f_out.write(erro_texto + "\n")
            
            # Pausa para evitar bloqueio (Rate Limit) do Instagram
            print("Aguardando 15 segundos para evitar banimento do Instagram...\n")
            time.sleep(15)
            
    print("Processo finalizado! O arquivo 'resultado.txt' foi gerado na sua pasta com todas as informações.")

if __name__ == "__main__":
    main()
